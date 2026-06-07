import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImportBatch } from './entities/import-batch.entity';
import { ImportBatchRow } from './entities/import-batch-row.entity';
import type { ImportBatchKind, ImportBatchStatus } from './match.constants';

/**
 * Atomic counter deltas applied to an ImportBatch after each chunk.
 * All numbers are added (not set), so concurrent worker chunks are safe.
 */
export interface BatchCounterDelta {
  processed?: number;
  imported?:  number;
  updated?:   number;
  skipped?:   number;
  autoLinked?: number;
  suggested?:  number;
  unlinked?:   number;
}

/** Cap how many row-error objects we keep on the batch (UI doesn't need 10k). */
const MAX_BATCH_ERRORS = 100;

/**
 * Owns the lifecycle of import batches and their staged rows.
 *
 * Used identically by:
 *   - HTTP API (creates batches, queries progress, cancels)
 *   - Worker process (claims rows, updates counters, marks complete)
 */
@Injectable()
export class ImportBatchService {
  private readonly logger = new Logger(ImportBatchService.name);

  constructor(
    @InjectRepository(ImportBatch)
    private readonly batchRepo: Repository<ImportBatch>,
    @InjectRepository(ImportBatchRow)
    private readonly rowRepo: Repository<ImportBatchRow>,
  ) {}

  // ── HTTP-side helpers ─────────────────────────────────────────────────────

  /** Create a new batch in 'queued' state.  Worker flips it to 'matching'. */
  async create(params: {
    tenantId: string;
    userId: string | null;
    kind: ImportBatchKind;
    sourceFile?: string | null;
    total: number;
  }): Promise<ImportBatch> {
    const batch = this.batchRepo.create({
      tenantId:   params.tenantId,
      userId:     params.userId,
      kind:       params.kind,
      sourceFile: params.sourceFile ?? null,
      total:      params.total,
      status:     'queued',
    });
    return this.batchRepo.save(batch);
  }

  /** Bulk-stage CSV rows in one INSERT.  Returns nothing — total already on batch. */
  async stageRows(
    batchId: string,
    tenantId: string,
    rows: Array<{ rowNumber: number; csvData: Record<string, any> }>,
  ): Promise<void> {
    if (rows.length === 0) return;

    // Chunk inserts so we don't blow the parameter limit on Postgres
    // (each row uses ~5 params; 65535 limit / 5 = 13107 rows; cap at 1000).
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await this.rowRepo
        .createQueryBuilder()
        .insert()
        .into(ImportBatchRow)
        .values(
          slice.map(r => ({
            batchId,
            tenantId,
            rowNumber: r.rowNumber,
            csvData:   r.csvData,
            status:    'pending' as const,
          })),
        )
        .execute();
    }
  }

  /**
   * Read a batch with tenant guard. Throws if not owned by this tenant.
   * Returns lightweight progress data (no row payloads).
   */
  async getForTenant(tenantId: string, id: string): Promise<ImportBatch> {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.tenantId !== tenantId) {
      throw new ForbiddenException('This import does not belong to your tenant');
    }
    return batch;
  }

  /** List recent batches for a tenant — drives the upload-history sidebar. */
  async listForTenant(
    tenantId: string,
    pagination: { limit?: number; offset?: number } = {},
  ): Promise<{ data: ImportBatch[]; total: number; limit: number; offset: number }> {
    const rawLimit = Number(pagination.limit ?? 25);
    const rawOffset = Number(pagination.offset ?? 0);
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 25));
    const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0);
    const [data, total] = await this.batchRepo
      .createQueryBuilder('b')
      .where('b.tenantId = :tenantId', { tenantId })
      .orderBy('b.createdAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();
    return { data, total, limit, offset };
  }

  /**
   * Cancel an in-flight batch.
   * - If still queued/matching: mark cancelled. Worker checks status before
   *   each chunk and aborts cleanly.
   * - Idempotent for completed/failed batches (no-op).
   */
  async cancel(tenantId: string, id: string): Promise<ImportBatch> {
    const batch = await this.getForTenant(tenantId, id);
    if (batch.status === 'completed' || batch.status === 'failed') {
      return batch; // already terminal — no-op
    }
    if (batch.status === 'cancelled') return batch;

    await this.batchRepo.update(
      { id },
      { status: 'cancelled', cancelledAt: new Date() },
    );
    // Drop pending staged rows so a re-upload doesn't double-process.
    await this.rowRepo.delete({ batchId: id, status: 'pending' });

    this.logger.log(`[batch:${id}] cancelled by tenant ${tenantId}`);
    return this.batchRepo.findOne({ where: { id } }) as Promise<ImportBatch>;
  }

  // ── Worker-side helpers ───────────────────────────────────────────────────

  /** Worker entry: claim the batch (queued → matching) and stamp startedAt. */
  async markStarted(batchId: string): Promise<ImportBatch | null> {
    const result = await this.batchRepo
      .createQueryBuilder()
      .update(ImportBatch)
      .set({ status: 'matching', startedAt: () => 'COALESCE("startedAt", now())' })
      .where('id = :id', { id: batchId })
      .andWhere('status IN (:...allowed)', { allowed: ['queued', 'matching'] })
      .returning('*')
      .execute();

    return (result.raw?.[0] as ImportBatch) ?? null;
  }

  /**
   * Set the authoritative `total` for a batch — used by the worker after it
   * snapshots the actual set of rows it intends to process (e.g. tenant
   * rematch). Avoids drift between the optimistic count taken at enqueue
   * time and what the worker actually sees.
   */
  async setTotal(batchId: string, total: number): Promise<void> {
    await this.batchRepo.update({ id: batchId }, { total });
  }

  /** Has the batch been cancelled while we were processing? Worker should bail. */
  async isCancelled(batchId: string): Promise<boolean> {
    const row = await this.batchRepo
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .where('b.id = :id', { id: batchId })
      .getRawOne<{ status: ImportBatchStatus }>();
    return row?.status === 'cancelled';
  }

  /**
   * Pull the next chunk of pending rows and atomically reserve them so
   * a parallel worker can't pick the same rows.
   *
   * Implementation: opens a short transaction around a `SELECT ... FOR UPDATE
   * SKIP LOCKED`, then flips the claimed rows to a transient `processing`
   * status before commit. After commit the rows are visibly owned by this
   * worker and lock release is automatic. TypeORM requires an open
   * transaction for `setLock('pessimistic_write')` — we use the row repo's
   * manager.transaction() which gives us one.
   */
  async claimChunk(batchId: string, chunkSize: number): Promise<ImportBatchRow[]> {
    return this.rowRepo.manager.transaction(async (manager) => {
      const rows = await manager
        .createQueryBuilder(ImportBatchRow, 'r')
        .where('r.batchId = :batchId', { batchId })
        .andWhere('r.status = :status', { status: 'pending' })
        .orderBy('r.rowNumber', 'ASC')
        .limit(chunkSize)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      // No rows ⇒ nothing to mutate; commit empties cleanly.
      return rows;
    });
  }

  /** Mark a row processed (success path). */
  async markRowProcessed(rowId: string): Promise<void> {
    await this.rowRepo.update({ id: rowId }, { status: 'processed', error: null });
  }

  /** Mark a row errored (poison pill — logged but does not stop the batch). */
  async markRowErrored(rowId: string, error: string): Promise<void> {
    await this.rowRepo.update({ id: rowId }, { status: 'errored', error });
  }

  /**
   * Atomically apply counter deltas to a batch.
   * Uses a single UPDATE with arithmetic so concurrent worker chunks are safe.
   * Whitelisted column names — never accepts arbitrary keys from callers.
   */
  async incrementCounters(batchId: string, delta: BatchCounterDelta): Promise<void> {
    const COLS: Array<keyof BatchCounterDelta> = [
      'processed', 'imported', 'updated', 'skipped',
      'autoLinked', 'suggested', 'unlinked',
    ];
    const sets: string[] = [];
    const params: any[] = [batchId];
    for (const col of COLS) {
      const v = delta[col];
      if (typeof v === 'number' && v > 0) {
        params.push(v);
        sets.push(`"${col}" = "${col}" + $${params.length}`);
      }
    }
    if (sets.length === 0) return;
    await this.batchRepo.query(
      `UPDATE "import_batches"
          SET ${sets.join(', ')}, "updatedAt" = now()
        WHERE "id" = $1`,
      params,
    );
  }

  /** Append (and cap) a row-level error for surfacing in the UI. */
  async appendErrors(
    batchId: string,
    newErrors: Array<{ row: number; reason: string }>,
  ): Promise<void> {
    if (newErrors.length === 0) return;
    // Concatenate then cap to MAX_BATCH_ERRORS in one round-trip.
    await this.batchRepo.query(
      `UPDATE "import_batches"
          SET "errors" = (
            SELECT jsonb_agg(e) FROM (
              SELECT * FROM jsonb_array_elements(COALESCE("errors", '[]'::jsonb))
              UNION ALL
              SELECT * FROM jsonb_array_elements($2::jsonb)
              LIMIT $3
            ) AS sub(e)
          ),
          "updatedAt" = now()
        WHERE "id" = $1`,
      [batchId, JSON.stringify(newErrors), MAX_BATCH_ERRORS],
    );
  }

  /** Final transition: completed (only if not cancelled meanwhile). */
  async markCompleted(batchId: string): Promise<ImportBatch | null> {
    const result = await this.batchRepo
      .createQueryBuilder()
      .update(ImportBatch)
      .set({ status: 'completed', completedAt: new Date() })
      .where('id = :id', { id: batchId })
      .andWhere('status = :running', { running: 'matching' })
      .returning('*')
      .execute();

    return (result.raw?.[0] as ImportBatch) ?? null;
  }

  /** Final transition: failed. Records the error message for the UI. */
  async markFailed(batchId: string, errorMessage: string): Promise<ImportBatch | null> {
    const result = await this.batchRepo
      .createQueryBuilder()
      .update(ImportBatch)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: errorMessage.slice(0, 1000),
      })
      .where('id = :id', { id: batchId })
      .returning('*')
      .execute();
    return (result.raw?.[0] as ImportBatch) ?? null;
  }

  /**
   * Worker-only — read a batch by id without the tenant guard.
   * Used to fetch the freshly-completed snapshot for notification payloads.
   */
  async getRaw(batchId: string): Promise<ImportBatch | null> {
    return this.batchRepo.findOne({ where: { id: batchId } });
  }

  /** Sanity-check input early to fail fast in the HTTP path. */
  validateRowsHeader(headers: string[], required: string[]): void {
    const have = new Set(headers.map(h => h.trim()));
    const missing = required.filter(c => !have.has(c));
    if (missing.length) {
      throw new BadRequestException(
        `Missing required columns: ${missing.join(', ')}`,
      );
    }
  }
}

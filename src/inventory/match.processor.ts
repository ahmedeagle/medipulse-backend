import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImportBatchService } from './import-batch.service';
import { InventoryImportService, RowOutcome } from './inventory-import.service';
import { CatalogMatchingService } from './catalog-matching.service';
import { InventoryItem } from './entities/inventory-item.entity';
import { ImportBatch } from './entities/import-batch.entity';
import { NotificationService } from '../notifications/notification.service';
import {
  MATCH_QUEUE,
  MATCH_BATCH_JOB,
  MATCH_TENANT_JOB,
  MATCH_CHUNK_SIZE,
} from './match.constants';

interface MatchBatchJobData {
  batchId:  string;
  tenantId: string;
}

interface MatchTenantJobData {
  batchId:  string;       // a control batch (kind='tenant_rematch') for progress
  tenantId: string;
}

/**
 * The single matcher worker.
 *
 * Concurrency is intentionally low: each row issues several DB queries
 * (catalog shortlist + scoring + insert/update). On a 2-vCPU pod, 2 concurrent
 * jobs ≈ 6–10 rows/s aggregate which keeps the DB CPU under 50 %.
 *
 * NEVER instantiated by the HTTP AppModule — only by the worker process.
 * The `@Processor` decorator turns this class into a BullMQ consumer that
 * dequeues from the `match` queue.
 */
@Processor(MATCH_QUEUE, { concurrency: 2 })
export class MatchProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchProcessor.name);

  constructor(
    private readonly batches: ImportBatchService,
    private readonly importer: InventoryImportService,
    private readonly matching: CatalogMatchingService,
    private readonly notifications: NotificationService,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
  ) {
    super();
  }

  async process(job: Job): Promise<{ outcome: string }> {
    if (job.name === MATCH_BATCH_JOB) {
      return this.runBatch(job as Job<MatchBatchJobData>);
    }
    if (job.name === MATCH_TENANT_JOB) {
      return this.runTenantRematch(job as Job<MatchTenantJobData>);
    }
    throw new Error(`Unknown match job kind: ${job.name}`);
  }

  // ── CSV upload batch ─────────────────────────────────────────────────────

  /**
   * Drain `import_batch_rows` for one batch in chunks of MATCH_CHUNK_SIZE.
   * Atomically updates batch counters after each chunk so the UI sees
   * progress every ~10 s on a 10 k upload.
   */
  private async runBatch(
    job: Job<MatchBatchJobData>,
  ): Promise<{ outcome: string }> {
    const { batchId, tenantId } = job.data;
    const claimed = await this.batches.markStarted(batchId);
    if (!claimed) {
      this.logger.warn(`[batch:${batchId}] not in queued/matching state — skipped`);
      return { outcome: 'skipped' };
    }

    let totalProcessed = 0;
    let chunkCount = 0;

    try {
      while (true) {
        if (await this.batches.isCancelled(batchId)) {
          this.logger.log(`[batch:${batchId}] cancelled — worker exiting`);
          return { outcome: 'cancelled' };
        }

        const chunk = await this.batches.claimChunk(batchId, MATCH_CHUNK_SIZE);
        if (chunk.length === 0) break; // no more pending rows

        chunkCount++;
        const errors: Array<{ row: number; reason: string }> = [];
        const delta = {
          processed: 0, imported: 0, updated: 0, skipped: 0,
          autoLinked: 0, suggested: 0, unlinked: 0,
        };

        for (const row of chunk) {
          const outcome = await this.importer.processRow(
            tenantId,
            row.rowNumber,
            row.csvData as any,
            batchId,
          );
          this.applyOutcome(delta, outcome);
          if (outcome.error) errors.push(outcome.error);

          if (outcome.error) {
            await this.batches.markRowErrored(row.id, outcome.error.reason);
          } else {
            await this.batches.markRowProcessed(row.id);
          }
          totalProcessed++;
        }

        await this.batches.incrementCounters(batchId, delta);
        if (errors.length) await this.batches.appendErrors(batchId, errors);

        // Surface progress to the BullMQ board (helpful for ops)
        await job.updateProgress(
          Math.min(99, Math.round((totalProcessed / Math.max(1, totalProcessed + chunk.length)) * 100)),
        );
      }

      const finalBatch = await this.batches.markCompleted(batchId);
      this.logger.log(
        `[batch:${batchId}] completed in ${chunkCount} chunks, ${totalProcessed} rows`,
      );
      await job.updateProgress(100);
      if (finalBatch) await this.notifyComplete(finalBatch);
      return { outcome: finalBatch ? 'completed' : 'already_terminal' };
    } catch (err: any) {
      this.logger.error(`[batch:${batchId}] failed: ${err.message}`, err.stack);
      const failed = await this.batches.markFailed(batchId, err.message ?? 'Worker error');
      if (failed) await this.notifyFailed(failed, err.message);
      throw err; // let Bull retry per attempts/backoff
    }
  }

  // ── Smart Link rematch / admin cascade ───────────────────────────────────

  /**
   * Re-run the matcher across the tenant's currently `unlinked` inventory rows.
   * Triggered by the "Smart Link" button or by CatalogRequest approval.
   *
   * Drives the same ImportBatch progress UI — the tenant sees a sticky toast
   * with live counters identical to a CSV upload.
   */
  private async runTenantRematch(
    job: Job<MatchTenantJobData>,
  ): Promise<{ outcome: string }> {
    const { batchId, tenantId } = job.data;
    const claimed = await this.batches.markStarted(batchId);
    if (!claimed) return { outcome: 'skipped' };

    try {
      let cursor: number | null = null;
      const PAGE = MATCH_CHUNK_SIZE;
      let totalProcessed = 0;

      while (true) {
        if (await this.batches.isCancelled(batchId)) {
          this.logger.log(`[rematch:${batchId}] cancelled`);
          return { outcome: 'cancelled' };
        }

        const qb = this.inventoryRepo
          .createQueryBuilder('item')
          .leftJoinAndSelect('item.product', 'product')
          .where('item.pharmacyTenantId = :tenantId', { tenantId })
          .andWhere('item.deletedAt IS NULL')
          .andWhere('item.linkStatus = :status', { status: 'unlinked' })
          .orderBy('item.createdAt', 'ASC')
          .limit(PAGE);

        if (cursor) qb.andWhere('item.createdAt > :cursor', { cursor: new Date(cursor) });

        const items = await qb.getMany();
        if (items.length === 0) break;
        cursor = items[items.length - 1].createdAt.getTime();

        const delta = {
          processed: 0, imported: 0, updated: 0, skipped: 0,
          autoLinked: 0, suggested: 0, unlinked: 0,
        };

        for (const item of items) {
          const result = await this.matching.runForItem(tenantId, item.id);
          delta.processed++;
          if (result === 'auto-linked') delta.autoLinked++;
          else if (result === 'suggested') delta.suggested++;
          else delta.unlinked++;
          totalProcessed++;
        }

        await this.batches.incrementCounters(batchId, delta);
        await job.updateProgress(
          Math.min(99, Math.round((totalProcessed / Math.max(1, totalProcessed + items.length)) * 100)),
        );
      }

      await this.batches.markCompleted(batchId);
      await job.updateProgress(100);
      this.logger.log(`[rematch:${batchId}] done, processed ${totalProcessed} items`);
      const finalBatch = await this.batches.getRaw(batchId);
      if (finalBatch) await this.notifyComplete(finalBatch);
      return { outcome: 'completed' };
    } catch (err: any) {
      this.logger.error(`[rematch:${batchId}] failed: ${err.message}`, err.stack);
      const failed = await this.batches.markFailed(batchId, err.message ?? 'Worker error');
      if (failed) await this.notifyFailed(failed, err.message);
      throw err;
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private applyOutcome(delta: any, outcome: RowOutcome): void {
    delta.processed++;
    delta[outcome.bucket]++;
    if (outcome.link) delta[outcome.link]++;
  }

  // ── Notifications ────────────────────────────────────────────────────────

  /**
   * Bilingual completion notice (Arabic primary / English fallback).
   * Goes to the user who started the batch — and the in-app bell badge shows
   * up immediately on their next page poll.
   *
   * The body string deliberately mentions the suggested-review count first
   * because that's the action the pharmacist needs to take next. Everything
   * else (auto-linked / new) is informational.
   */
  private async notifyComplete(batch: ImportBatch): Promise<void> {
    if (!batch.userId) return; // unattributed (cron / cascade) batches stay silent
    const isUpload = batch.kind === 'csv_upload';
    const titleAr = isUpload
      ? '✅ تم رفع المخزون بنجاح'
      : '✅ تم الربط الذكي للمنتجات';
    const reviewCount = batch.suggested ?? 0;

    const bodyAr = reviewCount > 0
      ? `تمت معالجة ${batch.processed} صف. لديك ${reviewCount} منتج بحاجة لمراجعة الربط الذكي.`
      : `تمت معالجة ${batch.processed} صف. تم ربط ${batch.autoLinked} تلقائياً.`;

    await this.notifications.create({
      tenantId: batch.tenantId,
      userId:   batch.userId,
      type:     'inventory_batch_complete',
      title:    titleAr,
      body:     bodyAr,
      // Deep-link the bell to the suggested-review filter so the click goes
      // straight to the actionable queue.
      resourceRef: reviewCount > 0
        ? `/pharmacy/inventory?linkStatus=suggested&batchId=${batch.id}`
        : `/pharmacy/inventory?batchId=${batch.id}`,
    });
  }

  private async notifyFailed(batch: ImportBatch, errorMsg: string): Promise<void> {
    if (!batch.userId) return;
    await this.notifications.create({
      tenantId: batch.tenantId,
      userId:   batch.userId,
      type:     'inventory_batch_failed',
      title:    '⚠️ فشلت معالجة المخزون',
      body:     `تعذر إكمال معالجة الملف. السبب: ${(errorMsg ?? 'خطأ غير معروف').slice(0, 200)}`,
      resourceRef: `/pharmacy/inventory/imports/${batch.id}`,
    });
  }

  // BullMQ event hooks (surfaced on Bull Board UI)
  onFailed(job: Job, err: Error): void {
    this.logger.error(`[match job:${job.id}] failed: ${err.message}`);
  }
}

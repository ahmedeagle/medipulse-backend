import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { InventoryItem } from './entities/inventory-item.entity';
import { Product } from './entities/product.entity';
import { ProductNormalizationService } from '../normalization/product-normalization.service';
import { CatalogMatchingService, MatchCandidate } from './catalog-matching.service';
import { ImportBatchService } from './import-batch.service';
import {
  MATCH_QUEUE,
  MATCH_BATCH_JOB,
} from './match.constants';

interface CsvRow {
  productName:   string;
  genericName?:  string;
  category:      string;
  unit:          string;
  quantity:      string;
  minThreshold?: string;
  expiryDate?:   string;
  barcode?:      string;
  manufacturer?: string;
  strength?:     string;
  dosageForm?:   string;
  nameAr?:       string;
}

/**
 * Per-row outcome.  The worker uses these to atomically increment batch
 * counters via ImportBatchService.incrementCounters.
 */
export interface RowOutcome {
  bucket: 'imported' | 'updated' | 'skipped';
  link:   'autoLinked' | 'suggested' | 'unlinked' | null;
  error?: { row: number; reason: string };
}

const REQUIRED_COLS: (keyof CsvRow)[] = ['productName', 'category', 'unit', 'quantity'];

/**
 * Bulk pharmacy inventory import.
 *
 * Two-phase pipeline:
 *
 *   Phase 1 — `ingestCsv` (sync, HTTP, < 5 s for any size):
 *     parse CSV, validate header, create an ImportBatch, bulk-stage rows in
 *     `import_batch_rows`, enqueue a MATCH_BATCH_JOB.  Returns { batchId }.
 *
 *   Phase 2 — `processRow` (called by the matcher worker):
 *     run the AI catalog matcher (linked/suggested/unlinked tiers), upsert
 *     into `inventory_items`, return a RowOutcome.  The worker chunks rows
 *     and atomically increments batch counters.
 *
 * The same per-row logic powers single uploads, the "Smart Link" rematch
 * button, and admin-cascade rematches — one decision tree, three triggers.
 */
@Injectable()
export class InventoryImportService {
  private readonly logger = new Logger(InventoryImportService.name);

  constructor(
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly normalization: ProductNormalizationService,
    private readonly matchingService: CatalogMatchingService,
    private readonly importBatchService: ImportBatchService,
    @InjectQueue(MATCH_QUEUE) private readonly matchQueue: Queue,
  ) {}

  // ── Phase 1: HTTP-side ingest (fast) ─────────────────────────────────────

  /**
   * Parse the CSV, create a batch, stage rows, enqueue a worker job.
   * Returns immediately with { batchId, total } — never blocks on matching.
   */
  async ingestCsv(
    pharmacyTenantId: string,
    userId: string | null,
    file: { buffer: Buffer; originalname?: string },
  ): Promise<{ batchId: string; total: number }> {
    let rows: CsvRow[];
    try {
      rows = parse(file.buffer, {
        columns:          (headers: string[]) => headers.map(h => h.trim().replace(/\s+/g, '')),
        skip_empty_lines: true,
        trim:             true,
      }) as CsvRow[];
    } catch (err: any) {
      throw new BadRequestException(`Invalid CSV format: ${err.message}`);
    }

    if (!rows.length) throw new BadRequestException('CSV contains no data rows');

    const missing = REQUIRED_COLS.filter(c => !(c in rows[0]));
    if (missing.length) {
      throw new BadRequestException(
        `Missing required columns: ${missing.join(', ')}`,
      );
    }

    const batch = await this.importBatchService.create({
      tenantId:   pharmacyTenantId,
      userId,
      kind:       'csv_upload',
      sourceFile: file.originalname ?? null,
      total:      rows.length,
    });

    await this.importBatchService.stageRows(
      batch.id,
      pharmacyTenantId,
      rows.map((row, i) => ({ rowNumber: i + 2, csvData: row as any })),
    );

    await this.matchQueue.add(
      MATCH_BATCH_JOB,
      { batchId: batch.id, tenantId: pharmacyTenantId },
      {
        // Idempotent: re-enqueue (e.g. retry of the HTTP call) won't double up
        jobId: `batch-${batch.id}`,
        removeOnComplete: { age: 86_400 },
        removeOnFail:     { age: 604_800 },
        attempts:         3,
        backoff:          { type: 'exponential', delay: 5_000 },
      },
    );

    this.logger.log(
      `[batch:${batch.id}] queued ${rows.length} rows for tenant ${pharmacyTenantId}`,
    );

    return { batchId: batch.id, total: rows.length };
  }

  // ── Phase 2: Worker-side per-row processor ───────────────────────────────

  /**
   * Process ONE staged row.  Pure function over (tenantId, csvRow).
   * Returns the outcome so the worker can update batch counters.
   * Never throws — captures errors as outcome.error so a poison row
   * doesn't kill the whole batch.
   */
  async processRow(
    pharmacyTenantId: string,
    rowNum: number,
    csvData: CsvRow,
    importBatchId: string | null,
  ): Promise<RowOutcome> {
    try {
      const qty = parseInt(csvData.quantity, 10);
      if (isNaN(qty) || qty < 0) {
        return {
          bucket: 'skipped',
          link:   null,
          error:  { row: rowNum, reason: `Invalid quantity: "${csvData.quantity}"` },
        };
      }
      if (!csvData.productName || !csvData.category || !csvData.unit) {
        return {
          bucket: 'skipped',
          link:   null,
          error:  { row: rowNum, reason: 'Missing productName, category, or unit' },
        };
      }

      const threshold  = csvData.minThreshold ? parseInt(csvData.minThreshold, 10) : 10;
      const expiryDate = csvData.expiryDate ? new Date(csvData.expiryDate) : null;

      const profile = {
        name:         csvData.productName,
        nameAr:       csvData.nameAr,
        barcode:      csvData.barcode?.trim() || undefined,
        manufacturer: csvData.manufacturer,
        strength:     csvData.strength,
        dosageForm:   csvData.dosageForm,
      };

      const candidates: MatchCandidate[] = await this.matchingService.findCandidates(profile, 5);
      const top = candidates[0];

      let productId: string;
      let linkStatus: 'linked' | 'suggested' | 'unlinked' = 'unlinked';
      let matchScore: number | null = null;
      let matchExplanation: any = null;
      let linkBucket: RowOutcome['link'] = 'unlinked';

      const corroborating = (sigs: string[]) =>
        sigs.some(s => s === 'name_exact' || s === 'name_strong' || s === 'name_partial' || s === 'manufacturer_match');

      if (top && top.score >= 95 && top.signals.includes('barcode_exact') && corroborating(top.signals)) {
        productId        = top.product.id;
        linkStatus       = 'linked';
        matchScore       = top.score;
        matchExplanation = { signals: top.signals, reasons: top.reasons, autoLinked: true, source: 'bulk_import' };
        linkBucket       = 'autoLinked';
      } else if (top && (top.score >= 70 || top.signals.includes('barcode_exact'))) {
        productId        = top.product.id;
        linkStatus       = 'suggested';
        matchScore       = top.score;
        matchExplanation = {
          signals: top.signals,
          reasons: top.reasons,
          suggestedProductId: top.product.id,
          source: 'bulk_import',
        };
        linkBucket = 'suggested';
      } else {
        // Pharmacy-local placeholder — requiresMapping=true keeps it cross-
        // tenant invisible until a system admin verifies via /normalization.
        const { canonicalName, strength, dosageForm } = this.normalization.normalize(
          csvData.productName, csvData.genericName,
        );
        try {
          const created = await this.productRepo.save(
            this.productRepo.create({
              name:           csvData.productName,
              nameAr:         csvData.nameAr ?? null,
              genericName:    csvData.genericName ?? null,
              category:       csvData.category,
              unit:           csvData.unit,
              barcode:        csvData.barcode?.trim() || null,
              manufacturer:   csvData.manufacturer ?? null,
              canonicalName,
              strength:       csvData.strength || strength,
              dosageForm:     csvData.dosageForm || dosageForm,
              isCanonical:    false,
              requiresMapping: true,
            }),
          );
          productId = created.id;
        } catch (err: any) {
          if (err?.code === '23505' && err?.constraint?.includes('barcode')) {
            return {
              bucket: 'skipped',
              link:   null,
              error: {
                row: rowNum,
                reason: `Barcode "${csvData.barcode}" conflicts with an unverified product. Pending admin review.`,
              },
            };
          }
          throw err;
        }
        linkStatus       = 'unlinked';
        matchScore       = null;
        matchExplanation = {
          reasonKey: 'no_canonical_match',
          topCandidateScore: top?.score ?? 0,
          source: 'bulk_import',
        };
        linkBucket = 'unlinked';
      }

      const existing = await this.inventoryRepo.findOne({
        where: { pharmacyTenantId, productId, deletedAt: null },
      });

      if (existing) {
        await this.inventoryRepo.update(existing.id, {
          quantity:     qty,
          minThreshold: isNaN(threshold) ? existing.minThreshold : threshold,
          expiryDate:   expiryDate ?? existing.expiryDate,
        });
        return { bucket: 'updated', link: linkBucket };
      }

      await this.inventoryRepo.save(
        this.inventoryRepo.create({
          pharmacyTenantId,
          productId,
          quantity:     qty,
          minThreshold: isNaN(threshold) ? 10 : threshold,
          expiryDate,
          linkStatus,
          matchScore,
          matchExplanation,
          lastLinkedAt: linkStatus === 'linked' ? new Date() : null,
          importBatchId,
        }),
      );
      return { bucket: 'imported', link: linkBucket };
    } catch (err: any) {
      this.logger.warn(`[batch row:${rowNum}] failed: ${err.message}`);
      return {
        bucket: 'skipped',
        link:   null,
        error:  { row: rowNum, reason: err.message ?? 'Unknown error' },
      };
    }
  }
}

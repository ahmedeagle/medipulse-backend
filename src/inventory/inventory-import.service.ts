import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { InventoryItem } from './entities/inventory-item.entity';
import { Product } from './entities/product.entity';
import { ProductNormalizationService } from '../normalization/product-normalization.service';
import { CatalogMatchingService, MatchCandidate } from './catalog-matching.service';

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

export interface InventoryImportResult {
  total:    number;
  imported: number;
  updated:  number;
  skipped:  number;
  /** Imported rows that auto-linked to a verified canonical product (score ≥ 95 + barcode + corroborating signal). */
  autoLinked: number;
  /** Imported rows that need pharmacist review in the queue (score in [70,95) or barcode-only). */
  suggested:  number;
  /** Imported rows that produced a new pharmacy-local product needing system-admin verification. */
  unlinked:   number;
  errors:   Array<{ row: number; reason: string }>;
}

const REQUIRED_COLS: (keyof CsvRow)[] = ['productName', 'category', 'unit', 'quantity'];

/**
 * Bulk pharmacy inventory import via CSV.
 *
 * This solves the biggest onboarding friction: pharmacies have 200–500 products
 * and entering them one-by-one through the UI is impossible.
 *
 * Flow:
 *   1. Parse CSV
 *   2. For each row: normalize product name → find or create canonical product
 *   3. If inventory item already exists for this pharmacy+product → update quantity
 *   4. If not exists → create new inventory item
 *   5. Return detailed import report
 *
 * CSV template columns (case-insensitive, spaces stripped):
 *   productName, genericName, category, unit, quantity, minThreshold, expiryDate, barcode
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
  ) {}

  async importCsv(
    pharmacyTenantId: string,
    fileBuffer: Buffer,
  ): Promise<InventoryImportResult> {
    let rows: CsvRow[];

    try {
      rows = parse(fileBuffer, {
        columns:          (headers: string[]) => headers.map((h) => h.trim().replace(/\s+/g, '')),
        skip_empty_lines: true,
        trim:             true,
      }) as CsvRow[];
    } catch (err: any) {
      throw new BadRequestException(`Invalid CSV format: ${err.message}`);
    }

    if (!rows.length) throw new BadRequestException('CSV contains no data rows');

    const missing = REQUIRED_COLS.filter((c) => !(c in rows[0]));
    if (missing.length) {
      throw new BadRequestException(`Missing required columns: ${missing.join(', ')}`);
    }

    const result: InventoryImportResult = {
      total: rows.length, imported: 0, updated: 0, skipped: 0,
      autoLinked: 0, suggested: 0, unlinked: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const rowNum = i + 2;

      try {
        const qty = parseInt(row.quantity, 10);
        if (isNaN(qty) || qty < 0) {
          result.errors.push({ row: rowNum, reason: `Invalid quantity: "${row.quantity}"` });
          result.skipped++;
          continue;
        }

        const threshold = row.minThreshold ? parseInt(row.minThreshold, 10) : 10;
        const expiryDate = row.expiryDate ? new Date(row.expiryDate) : null;

        // ── Catalog matching (single source of truth, identical to manual flow) ──
        // Run the AI matcher against the verified canonical catalog. Anything
        // it filters out (requiresMapping=true) stays cross-tenant invisible
        // exactly like in the wizard. The decision tiers must match the
        // bulk runMatchingForTenant() rules so users see consistent behavior.
        const profile = {
          name:         row.productName,
          nameAr:       row.nameAr,
          barcode:      row.barcode?.trim() || undefined,
          manufacturer: row.manufacturer,
          strength:     row.strength,
          dosageForm:   row.dosageForm,
        };

        const candidates: MatchCandidate[] = await this.matchingService.findCandidates(profile, 5);
        const top = candidates[0];

        let productId: string;
        let linkStatus: 'linked' | 'suggested' | 'unlinked' = 'unlinked';
        let matchScore: number | null = null;
        let matchExplanation: any = null;

        const corroborating = (sigs: string[]) =>
          sigs.some((s) => s === 'name_exact' || s === 'name_strong' || s === 'name_partial' || s === 'manufacturer_match');

        if (top && top.score >= 95 && top.signals.includes('barcode_exact') && corroborating(top.signals)) {
          // AUTO-LINK: barcode + at least one name/manufacturer signal at high score.
          productId        = top.product.id;
          linkStatus       = 'linked';
          matchScore       = top.score;
          matchExplanation = { signals: top.signals, reasons: top.reasons, autoLinked: true, source: 'bulk_import' };
          result.autoLinked++;
        } else if (top && (top.score >= 70 || top.signals.includes('barcode_exact'))) {
          // SUGGESTED: link inventory to top match BUT mark for human review.
          // Barcode-only matches always land here (defense in depth — single
          // signal is not enough for unattended auto-link).
          productId        = top.product.id;
          linkStatus       = 'suggested';
          matchScore       = top.score;
          matchExplanation = {
            signals: top.signals,
            reasons: top.reasons,
            suggestedProductId: top.product.id,
            source: 'bulk_import',
          };
          result.suggested++;
        } else {
          // No good match. Create a pharmacy-local product flagged for system
          // admin verification — NOT a globally-visible canonical entry. This
          // is the fix for the previous catalog-leak behavior where every CSV
          // typo became a verified canonical product.
          const { canonicalName, strength, dosageForm } = this.normalization.normalize(
            row.productName, row.genericName,
          );
          try {
            const created = await this.productRepo.save(
              this.productRepo.create({
                name:           row.productName,
                nameAr:         row.nameAr ?? null,
                genericName:    row.genericName ?? null,
                category:       row.category,
                unit:           row.unit,
                barcode:        row.barcode?.trim() || null,
                manufacturer:   row.manufacturer ?? null,
                canonicalName,
                strength:       row.strength || strength,
                dosageForm:     row.dosageForm || dosageForm,
                isCanonical:    false,   // ← not promoted to canonical
                requiresMapping: true,    // ← hidden from cross-tenant matching until system admin verifies
              }),
            );
            productId = created.id;
          } catch (err: any) {
            // Barcode unique-constraint collision: another tenant already
            // created an unverified product with the same barcode. Surface as
            // a row error rather than silently linking to potentially-dirty
            // data — system admin must merge them via /normalization.
            if (err?.code === '23505' && err?.constraint?.includes('barcode')) {
              result.errors.push({
                row: rowNum,
                reason: `Barcode "${row.barcode}" conflicts with another unverified product. Pending system admin review.`,
              });
              result.skipped++;
              continue;
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
          result.unlinked++;
        }

        // ── Inventory item upsert ────────────────────────────────────────────
        const existing = await this.inventoryRepo.findOne({
          where: { pharmacyTenantId, productId, deletedAt: null },
        });

        if (existing) {
          await this.inventoryRepo.update(existing.id, {
            quantity:     qty,
            minThreshold: isNaN(threshold) ? existing.minThreshold : threshold,
            expiryDate:   expiryDate ?? existing.expiryDate,
          });
          result.updated++;
        } else {
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
            }),
          );
          result.imported++;
        }
      } catch (err: any) {
        result.errors.push({ row: rowNum, reason: err.message });
        result.skipped++;
      }
    }

    this.logger.log(
      `Inventory import for ${pharmacyTenantId}: ` +
      `${result.imported} new, ${result.updated} updated, ${result.skipped} skipped, ` +
      `${result.autoLinked} auto-linked, ${result.suggested} for review, ${result.unlinked} unlinked`,
    );

    return result;
  }
}

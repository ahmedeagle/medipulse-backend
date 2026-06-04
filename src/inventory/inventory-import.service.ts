import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { InventoryItem } from './entities/inventory-item.entity';
import { ProductNormalizationService } from '../normalization/product-normalization.service';

interface CsvRow {
  productName:   string;
  genericName?:  string;
  category:      string;
  unit:          string;
  quantity:      string;
  minThreshold?: string;
  expiryDate?:   string;
  barcode?:      string;
}

export interface InventoryImportResult {
  total:    number;
  imported: number;
  updated:  number;
  skipped:  number;
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
    private readonly normalization: ProductNormalizationService,
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
      total: rows.length, imported: 0, updated: 0, skipped: 0, errors: [],
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

        // Resolve or create canonical product
        const product = await this.normalization.findOrCreateCanonical({
          name:        row.productName,
          genericName: row.genericName,
          category:    row.category,
          unit:        row.unit,
        });

        // Check if inventory item already exists
        const existing = await this.inventoryRepo.findOne({
          where: { pharmacyTenantId, productId: product.id, deletedAt: null },
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
              productId:    product.id,
              quantity:     qty,
              minThreshold: isNaN(threshold) ? 10 : threshold,
              expiryDate:   expiryDate,
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
      `${result.imported} new, ${result.updated} updated, ${result.skipped} skipped`,
    );

    return result;
  }
}

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { SupplierCatalogItem } from './entities/supplier-catalog-item.entity';
import { ProductNormalizationService } from '../normalization/product-normalization.service';

interface CsvRow {
  productName:  string;
  genericName?: string;
  category:     string;
  unit:         string;
  price:        string;
  currency?:    string;
  stock?:       string;
  supplierSku?: string;
}

export interface ImportResult {
  total:    number;
  imported: number;
  skipped:  number;
  unmapped: number;
  errors:   Array<{ row: number; reason: string }>;
}

const REQUIRED_COLUMNS: (keyof CsvRow)[] = ['productName', 'category', 'unit', 'price'];

/**
 * Bulk supplier catalog import via CSV.
 *
 * Expected CSV headers (case-insensitive):
 *   productName, genericName, category, unit, price, currency, stock, supplierSku
 *
 * For each row:
 *   1. Normalization engine attempts to find/create canonical product
 *   2. If supplierSku provided, registers alias mapping
 *   3. Creates or updates SupplierCatalogItem
 */
@Injectable()
export class CatalogImportService {
  private readonly logger = new Logger(CatalogImportService.name);

  constructor(
    @InjectRepository(SupplierCatalogItem)
    private readonly catalogRepo: Repository<SupplierCatalogItem>,
    private readonly normalization: ProductNormalizationService,
  ) {}

  async importCsv(
    supplierTenantId: string,
    fileBuffer: Buffer,
  ): Promise<ImportResult> {
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

    if (!rows.length) throw new BadRequestException('CSV file contains no data rows');

    // Validate required columns
    const firstRow = rows[0];
    const missing = REQUIRED_COLUMNS.filter((col) => !(col in firstRow));
    if (missing.length) {
      throw new BadRequestException(`Missing required columns: ${missing.join(', ')}`);
    }

    const result: ImportResult = {
      total: rows.length, imported: 0, skipped: 0, unmapped: 0, errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-indexed + header

      try {
        const price = parseFloat(row.price);
        if (isNaN(price) || price < 0) {
          result.errors.push({ row: rowNum, reason: `Invalid price: "${row.price}"` });
          result.skipped++;
          continue;
        }

        // Find or create canonical product via normalization engine
        const product = await this.normalization.findOrCreateCanonical({
          name:        row.productName,
          genericName: row.genericName,
          category:    row.category,
          unit:        row.unit,
        });

        // Register supplier SKU alias if provided
        if (row.supplierSku?.trim()) {
          await this.normalization.mapSupplierSku(
            supplierTenantId,
            row.supplierSku.trim(),
            product.id,
            row.productName,
          );
        }

        // Check if product requires manual admin mapping
        if (product.requiresMapping) result.unmapped++;

        // Upsert catalog item
        const existing = await this.catalogRepo.findOne({
          where: { supplierTenantId, productId: product.id, deletedAt: null },
        });

        if (existing) {
          await this.catalogRepo.update(existing.id, {
            price,
            currency:    row.currency ?? 'SAR',
            stock:       row.stock ? parseInt(row.stock, 10) : existing.stock,
            isAvailable: true,
          });
        } else {
          await this.catalogRepo.save(
            this.catalogRepo.create({
              supplierTenantId,
              productId:   product.id,
              price,
              currency:    row.currency ?? 'SAR',
              stock:       row.stock ? parseInt(row.stock, 10) : 0,
              isAvailable: true,
            }),
          );
        }

        result.imported++;
      } catch (err: any) {
        result.errors.push({ row: rowNum, reason: err.message });
        result.skipped++;
      }
    }

    this.logger.log(
      `CSV import for ${supplierTenantId}: ${result.imported} imported, ${result.skipped} skipped, ${result.unmapped} need mapping`,
    );

    return result;
  }
}

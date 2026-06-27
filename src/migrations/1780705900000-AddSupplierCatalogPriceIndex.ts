import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a partial composite index on supplier_catalog tuned for the
 * "resolve best supplier per product" query used by:
 *   - PurchasesService.createOrdersFromWishList (lowest-price supplier lookup)
 *   - ProcurementDraftService (same heuristic)
 *
 * The query filters on (productId IN $1, isAvailable=true, deletedAt IS NULL)
 * and orders by (productId, price ASC) so DISTINCT ON picks the cheapest row.
 *
 * Without this index PostgreSQL must scan every catalog row matching the
 * product ids and then sort. At scale (10k+ suppliers per product) the sort
 * step dominates latency. The partial WHERE clause keeps the index small.
 */
export class AddSupplierCatalogPriceIndex1780705900000 implements MigrationInterface {
  name = 'AddSupplierCatalogPriceIndex1780705900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_catalog_product_available_price"
        ON "supplier_catalog" ("productId", "price")
        WHERE "isAvailable" = true AND "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_supplier_catalog_product_available_price"`);
  }
}

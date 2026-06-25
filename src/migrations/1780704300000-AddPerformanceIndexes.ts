import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1780704300000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1780704300000';
  // CONCURRENTLY requires running outside a transaction
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pg_trgm for LIKE/ILIKE full-scan acceleration
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Trigram GIN indexes — required for leading-wildcard LIKE '%q%' queries
    // Without these, LOWER(name) LIKE '%q%' is a full sequential scan at any scale
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_trgm
        ON products USING gin (name gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_ar_trgm
        ON products USING gin ("nameAr" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active_ingredient_trgm
        ON products USING gin ("activeIngredient" gin_trgm_ops)
    `);

    // B-tree on product name for ORDER BY name ASC (used in findSmartProducts)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_name_btree
        ON products (name ASC)
    `);

    // Composite index for expiry-based FEFO queries and exiring_soon filter
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_batches_expiry_status
        ON product_batches ("pharmacyTenantId", status, "expiryDate")
        WHERE "noExpiry" = false
    `);

    // Index on product_batches.productId + expiryDate for nearest-expiry aggregation
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_batches_product_expiry
        ON product_batches ("productId", "expiryDate")
        WHERE status = 'active' AND "noExpiry" = false
    `);

    // Index for inventory_items lookup in smart table LEFT JOIN
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inventory_items_product_tenant
        ON inventory_items ("productId", "pharmacyTenantId")
        WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inventory_items_product_tenant`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_batches_product_expiry`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_batches_expiry_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_name_btree`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_active_ingredient_trgm`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_name_ar_trgm`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_name_trgm`);
  }
}

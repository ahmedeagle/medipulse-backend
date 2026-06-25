import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReportIndexes1780704000000 implements MigrationInterface {
  name = 'AddReportIndexes1780704000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Enable trigram extension for fast ILIKE search
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // inventory_items: composite index for expiry report (tenant + deletedAt + expiryDate)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_inv_items_tenant_expiry"
        ON inventory_items ("pharmacyTenantId", "expiryDate" ASC)
        WHERE "deletedAt" IS NULL AND "expiryDate" IS NOT NULL
    `);

    // inventory_items: composite for inventory report GROUP BY productId
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_inv_items_tenant_product"
        ON inventory_items ("pharmacyTenantId", "productId")
        WHERE "deletedAt" IS NULL
    `);

    // pos_transaction_items: productId used in GROUP BY for sales-by-product
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pos_items_product_id"
        ON pos_transaction_items ("productId")
    `);

    // pos_transaction_items: inventoryItemId JOIN for cost price lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pos_items_inventory_id"
        ON pos_transaction_items ("inventoryItemId")
        WHERE "inventoryItemId" IS NOT NULL
    `);

    // products: trigram index for fast ILIKE search on sku, name, barcode
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_products_sku_trgm"
        ON products USING gin(sku gin_trgm_ops)
        WHERE sku IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_products_name_trgm"
        ON products USING gin(name gin_trgm_ops)
        WHERE name IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_products_barcode_btree"
        ON products (barcode)
        WHERE barcode IS NOT NULL
    `);

    // pos_transactions: status + type compound index for sales report filters
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pos_tx_tenant_status_type_created"
        ON pos_transactions ("pharmacyTenantId", status, type, "createdAt" DESC)
        WHERE status = 'completed'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pos_tx_tenant_status_type_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_barcode_btree"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_sku_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pos_items_inventory_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pos_items_product_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_inv_items_tenant_product"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_inv_items_tenant_expiry"`);
  }
}

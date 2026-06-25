import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryProductFields1780704200000 implements MigrationInterface {
  name = 'AddInventoryProductFields1780704200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Product table: Phase 1 compliance fields ────────────────────────────

    // F-02: VAT / tax rate per product
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0
    `);

    // F-06: Lifecycle & behaviour toggles
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS "disablePOSSale" BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS "disablePurchase" BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS "returnable" BOOLEAN NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS "discountAllowed" BOOLEAN NOT NULL DEFAULT true
    `);

    // ── ProductBatch table: F-03 no-expiry toggle ───────────────────────────
    await queryRunner.query(`
      ALTER TABLE product_batches
        ADD COLUMN IF NOT EXISTS "noExpiry" BOOLEAN NOT NULL DEFAULT false
    `);

    // Index for smart product table query (F-05) — batch count + nearest expiry
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_batches_tenant_product_status
        ON product_batches ("pharmacyTenantId", "productId", status)
    `);

    // Index to accelerate isActive filter in product searches
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_is_active
        ON products ("isActive")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_is_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_batches_tenant_product_status`);

    await queryRunner.query(`ALTER TABLE product_batches DROP COLUMN IF EXISTS "noExpiry"`);

    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS "discountAllowed"`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS "returnable"`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS "disablePurchase"`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS "disablePOSSale"`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS "isActive"`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS "taxRate"`);
  }
}

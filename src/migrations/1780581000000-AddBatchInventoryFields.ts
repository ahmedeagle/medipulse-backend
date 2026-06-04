import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-pharmacy inventory tracking columns to product_batches so each
 * received lot can carry its own quantity, location, pricing and audit metadata.
 *
 * The parent inventory_items row keeps the AGGREGATE quantity (SUM of active
 * batches) and the FEFO-soonest batchNumber/expiryDate for the table summary.
 */
export class AddBatchInventoryFields1780581000000 implements MigrationInterface {
  name = 'AddBatchInventoryFields1780581000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "pharmacyTenantId" uuid`);
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "inventoryItemId"  uuid`);
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "quantity"         integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "receivedQuantity" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "sellingPrice"     numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "location"         varchar(100) DEFAULT 'Main Warehouse'`);
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "notes"            text`);
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "createdByUserId"  uuid`);
    await queryRunner.query(`ALTER TABLE "product_batches" ADD IF NOT EXISTS "updatedAt"        timestamp NOT NULL DEFAULT now()`);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_product_batches_inventory_status" ON "product_batches" ("inventoryItemId","status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_product_batches_pharmacy_status" ON "product_batches" ("pharmacyTenantId","status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_batches_pharmacy_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_batches_inventory_status"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "createdByUserId"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "notes"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "location"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "sellingPrice"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "receivedQuantity"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "quantity"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "inventoryItemId"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "pharmacyTenantId"`);
  }
}

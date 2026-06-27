import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProcurementPerfIndexes1780704700000 implements MigrationInterface {
  name = 'AddProcurementPerfIndexes1780704700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. price_snapshots — getPriceIntelligence scans by product + date window
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_price_snapshots_product_date"
      ON price_snapshots ("productId", "recordedAt" DESC)
    `);

    // 2. supplier_catalog — market availability GROUP BY productId with isAvailable/stock filters
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_catalog_product_available"
      ON supplier_catalog ("productId", "isAvailable", stock)
      WHERE "deletedAt" IS NULL
    `);

    // 3. procurement_drafts — cart GET filters by pharmacyTenantId + status
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_procurement_drafts_tenant_status"
      ON procurement_drafts ("pharmacyTenantId", status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_price_snapshots_product_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_supplier_catalog_product_available"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_procurement_drafts_tenant_status"`);
  }
}

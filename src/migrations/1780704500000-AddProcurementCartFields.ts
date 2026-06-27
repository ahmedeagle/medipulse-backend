import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 2 — Procurement OS: extends procurement_drafts to support
 * AI-generated multi-source cart plans.
 *
 * Performance notes:
 *  - idx_drafts_cart: composite index on (pharmacyTenantId, sourceType, status)
 *    for the fast "get my cart" query (tenant + ai_plan + pending_review).
 *  - supplierTenantId is made nullable to support P2P-sourced splits that
 *    have no supplier tenant.
 */
export class AddProcurementCartFields1780704500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make supplierTenantId nullable (P2P splits have no supplier)
    await queryRunner.query(`
      ALTER TABLE procurement_drafts
        ALTER COLUMN "supplierTenantId" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE procurement_drafts
        ADD COLUMN IF NOT EXISTS "sourceType"        VARCHAR(10)  NOT NULL DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS "splitSource"       VARCHAR(10)  NULL,
        ADD COLUMN IF NOT EXISTS "p2pListingId"      UUID         NULL,
        ADD COLUMN IF NOT EXISTS "planSnapshot"      JSONB        NULL,
        ADD COLUMN IF NOT EXISTS "signalFreshnessAt" TIMESTAMP    NULL
    `);

    // Fast cart query: all AI-plan pending drafts for a tenant
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_drafts_cart
        ON procurement_drafts ("pharmacyTenantId", "sourceType", status)
        WHERE "sourceType" = 'ai_plan'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_drafts_cart`);

    await queryRunner.query(`
      ALTER TABLE procurement_drafts
        DROP COLUMN IF EXISTS "signalFreshnessAt",
        DROP COLUMN IF EXISTS "planSnapshot",
        DROP COLUMN IF EXISTS "p2pListingId",
        DROP COLUMN IF EXISTS "splitSource",
        DROP COLUMN IF EXISTS "sourceType"
    `);

    await queryRunner.query(`
      ALTER TABLE procurement_drafts
        ALTER COLUMN "supplierTenantId" SET NOT NULL
    `);
  }
}

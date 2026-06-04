import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 — Catalog Linking & Catalog Requests
 *
 * Adds explicit catalog-link metadata to every pharmacy inventory item:
 *   - linkStatus  : linked | unlinked | suggested | pending
 *   - matchScore  : confidence 0..100
 *   - matchExplanation : structured JSON of matching signals (barcode, name, mfr…)
 *   - lastLinkedAt
 *
 * Creates the catalog_requests ticketing table — every "add to catalog" or
 * "fix this product" request from a pharmacy gets a tracking number (REQ-XXXX),
 * a payload snapshot, and a full lifecycle (submitted → review → decision).
 */
export class AddCatalogLinking1780585000000 implements MigrationInterface {
  name = 'AddCatalogLinking1780585000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── inventory_items: link-status columns ───────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "linkStatus" varchar(20) NOT NULL DEFAULT 'unlinked'`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "matchScore" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "matchExplanation" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "lastLinkedAt" timestamp`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_inventory_items_link_status"
         ON "inventory_items" ("pharmacyTenantId","linkStatus")`,
    );

    // Best-effort backfill: anything with a productId pointing at a real
    // catalog row counts as "linked" with a confident barcode score.
    await queryRunner.query(`
      UPDATE "inventory_items" i
         SET "linkStatus"   = 'linked',
             "matchScore"   = COALESCE(i."matchScore", 95),
             "lastLinkedAt" = COALESCE(i."lastLinkedAt", i."createdAt")
        FROM "products" p
       WHERE i."productId" = p."id"
         AND i."linkStatus" = 'unlinked'
    `);

    // ── catalog_requests table ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "catalog_requests" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trackingNumber"   varchar(20) NOT NULL UNIQUE,
        "pharmacyTenantId" uuid NOT NULL,
        "inventoryItemId"  uuid,
        "createdByUserId"  uuid,
        "type"             varchar(20) NOT NULL DEFAULT 'add',
        "status"           varchar(20) NOT NULL DEFAULT 'submitted',
        "payload"          jsonb NOT NULL,
        "adminDecision"    varchar(20),
        "adminUserId"      uuid,
        "adminNotes"       text,
        "rejectionReason"  text,
        "resolvedCatalogProductId" uuid,
        "timeline"         jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdAt"        timestamp NOT NULL DEFAULT now(),
        "updatedAt"        timestamp NOT NULL DEFAULT now(),
        "resolvedAt"       timestamp
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_catalog_requests_pharmacy_status"
         ON "catalog_requests" ("pharmacyTenantId","status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_catalog_requests_status_created"
         ON "catalog_requests" ("status","createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_catalog_requests_tracking"
         ON "catalog_requests" ("trackingNumber")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_catalog_requests_tracking"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_catalog_requests_status_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_catalog_requests_pharmacy_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog_requests"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_inventory_items_link_status"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "lastLinkedAt"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "matchExplanation"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "matchScore"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "linkStatus"`);
  }
}

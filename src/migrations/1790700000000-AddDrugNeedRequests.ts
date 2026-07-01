import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * drug_need_requests — pharmacy-initiated demand capture ("أحتاج دواء").
 * Powers on-demand sourcing (via ProcurementOrchestrator) and the future Shortage Radar.
 */
export class AddDrugNeedRequests1790700000000 implements MigrationInterface {
  name = 'AddDrugNeedRequests1790700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "drug_need_requests" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "pharmacyTenantId"   uuid NOT NULL,
        "productId"          uuid NULL,
        "productName"        varchar(255) NOT NULL,
        "requestedQty"       int NOT NULL DEFAULT 1,
        "urgency"            varchar(12) NOT NULL DEFAULT 'normal',
        "status"             varchar(16) NOT NULL DEFAULT 'open',
        "region"             varchar(120) NULL,
        "sourceOptionsCount" int NOT NULL DEFAULT 0,
        "resultSnapshot"     jsonb NULL,
        "expiresAt"          timestamptz NULL,
        "createdAt"          timestamp NOT NULL DEFAULT NOW(),
        "updatedAt"          timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_drug_need_tenant_status"
        ON "drug_need_requests" ("pharmacyTenantId", "status")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_drug_need_product_status"
        ON "drug_need_requests" ("productId", "status")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_drug_need_product_status"`);
    await q.query(`DROP INDEX IF EXISTS "idx_drug_need_tenant_status"`);
    await q.query(`DROP TABLE IF EXISTS "drug_need_requests"`);
  }
}

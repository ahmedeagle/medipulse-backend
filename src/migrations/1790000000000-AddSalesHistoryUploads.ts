import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * sales_history_uploads — stores raw historical sales/purchase files a pharmacy
 * uploads at onboarding. Ops processes them later to backfill consumption
 * history (unlocking forecasting + seasonal radar from day one). Files are
 * stored as bytea and never parsed on the live request path.
 */
export class AddSalesHistoryUploads1790000000000 implements MigrationInterface {
  name = 'AddSalesHistoryUploads1790000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "sales_history_uploads" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId"         uuid NOT NULL,
        "uploadedByUserId" uuid NULL,
        "fileName"         varchar(255) NOT NULL,
        "fileSize"         int NOT NULL,
        "mimeType"         varchar(120) NULL,
        "fileContent"      bytea NOT NULL,
        "kind"             varchar(20) NOT NULL DEFAULT 'unspecified',
        "note"             text NULL,
        "status"           varchar(20) NOT NULL DEFAULT 'pending',
        "createdAt"        timestamp NOT NULL DEFAULT NOW()
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_sales_history_uploads_tenant_created"
        ON "sales_history_uploads" ("tenantId", "createdAt" DESC)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_sales_history_uploads_tenant_created"`);
    await q.query(`DROP TABLE IF EXISTS "sales_history_uploads"`);
  }
}

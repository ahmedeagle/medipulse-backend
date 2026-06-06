import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Async bulk-import & catalog matching.
 *
 * Architectural change: bulk import becomes a 2-phase pipeline:
 *   1. INGEST (sync, < 5 s for any size): parse CSV, validate header, bulk-insert
 *      raw rows into `import_batch_rows` and a control row in `import_batches`.
 *   2. MATCH (async worker): pulls rows in chunks of 200, runs the AI catalog
 *      matcher (linked / suggested / unlinked), promotes them into
 *      `inventory_items`, and atomically updates batch counters.
 *
 * This is the only architecture that:
 *   - Survives 10 k+ row uploads without HTTP timeouts (Egypt/KSA mobile data).
 *   - Lets pharmacist cancel mid-run with a single DELETE on the batch.
 *   - Powers the same "Smart Link" button — re-scanning unlinked items for a
 *     tenant uses the identical worker via a different job kind.
 *   - Enables auto-rematch on CatalogRequest approval (one admin click → all
 *     affected tenants healed in the background).
 */
export class AddImportBatches1780600000000 implements MigrationInterface {
  name = 'AddImportBatches1780600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── import_batches: one row per upload / rematch run ───────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "import_batches" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId"      uuid NOT NULL,
        "userId"        uuid,
        "kind"          varchar(30) NOT NULL DEFAULT 'csv_upload',
        "status"        varchar(20) NOT NULL DEFAULT 'queued',
        "sourceFile"    varchar(255),
        "total"         int NOT NULL DEFAULT 0,
        "processed"     int NOT NULL DEFAULT 0,
        "imported"      int NOT NULL DEFAULT 0,
        "updated"       int NOT NULL DEFAULT 0,
        "skipped"       int NOT NULL DEFAULT 0,
        "autoLinked"    int NOT NULL DEFAULT 0,
        "suggested"     int NOT NULL DEFAULT 0,
        "unlinked"      int NOT NULL DEFAULT 0,
        "errors"        jsonb NOT NULL DEFAULT '[]'::jsonb,
        "errorMessage"  text,
        "startedAt"     timestamp,
        "completedAt"   timestamp,
        "cancelledAt"   timestamp,
        "createdAt"     timestamp NOT NULL DEFAULT now(),
        "updatedAt"     timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_import_batches_tenant_status_created"
         ON "import_batches" ("tenantId","status","createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_import_batches_status"
         ON "import_batches" ("status") WHERE "status" IN ('queued','matching')`,
    );

    // ── import_batch_rows: staging table consumed by the matcher worker ────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "import_batch_rows" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "batchId"     uuid NOT NULL,
        "tenantId"    uuid NOT NULL,
        "rowNumber"   int NOT NULL,
        "csvData"     jsonb NOT NULL,
        "status"      varchar(20) NOT NULL DEFAULT 'pending',
        "error"       text,
        "createdAt"   timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_import_batch_rows_batch"
          FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_import_batch_rows_batch_status"
         ON "import_batch_rows" ("batchId","status")`,
    );

    // ── inventory_items: track which batch produced each row (audit) ───────
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "importBatchId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_inventory_items_batch"
         ON "inventory_items" ("importBatchId") WHERE "importBatchId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_inventory_items_batch"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "importBatchId"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_import_batch_rows_batch_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_batch_rows"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_import_batches_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_import_batches_tenant_status_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_batches"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ai_recovery_events — persisted Financial Impact Measurement layer.
 * See RecoveryEvent entity for the full rationale. Indexes are built for the
 * grouped time-range aggregation used by the AI Center impact report; the unique
 * constraint guarantees idempotent writes (no double-counting on cron/executor
 * retries).
 */
export class AddAiRecoveryEvents1790900000000 implements MigrationInterface {
  name = 'AddAiRecoveryEvents1790900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_recovery_events" (
        "id"               uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "pharmacyTenantId" uuid         NOT NULL,
        "type"             varchar(32)  NOT NULL,
        "status"           varchar(16)  NOT NULL DEFAULT 'realized',
        "amountEgp"        numeric(14,2) NOT NULL DEFAULT 0,
        "expectedValueEgp" numeric(14,2) NULL,
        "realizedValueEgp" numeric(14,2) NULL,
        "productId"        uuid         NULL,
        "sourceType"       varchar(24)  NOT NULL,
        "sourceId"         varchar(64)  NULL,
        "subjectType"      varchar(40)  NULL,
        "metadata"         jsonb        NULL,
        "createdAt"        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_recovery_events" PRIMARY KEY ("id")
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_recovery_tenant_created"
        ON "ai_recovery_events" ("pharmacyTenantId", "createdAt")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_recovery_tenant_type_created"
        ON "ai_recovery_events" ("pharmacyTenantId", "type", "createdAt")
    `);
    // Idempotency: a given (source, type) can only be recorded once. NULL sourceId
    // rows don't collide (Postgres treats NULLs as distinct), which is intentional —
    // only sourced events (approvals/orders) are deduped.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_recovery_source"
        ON "ai_recovery_events" ("sourceType", "sourceId", "type")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_recovery_events"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Metered usage + plan tier. Adds:
 *   • tenants.planTier — which plan's caps apply (default 'free')
 *   • usage_counters   — per-tenant per-month AI & WhatsApp consumption
 *
 * This makes the caps advertised on the pricing page actually enforceable: AI
 * assistant calls and outbound WhatsApp are counted here and blocked when the
 * monthly cap is reached.
 */
export class AddUsageMetering1791200000000 implements MigrationInterface {
  name = 'AddUsageMetering1791200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "planTier" varchar(16) NOT NULL DEFAULT 'free'
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "usage_counters" (
        "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "pharmacyTenantId"       uuid        NOT NULL,
        "period"                 varchar(7)  NOT NULL,
        "aiRequests"             int         NOT NULL DEFAULT 0,
        "whatsappConversations"  int         NOT NULL DEFAULT 0,
        "createdAt"              timestamptz NOT NULL DEFAULT now(),
        "updatedAt"              timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_usage_tenant_period"
        ON "usage_counters" ("pharmacyTenantId", "period")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "usage_counters"`);
    await q.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "planTier"`);
  }
}

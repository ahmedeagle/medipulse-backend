import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a `feature` dimension to `ai_token_usage` so that runaway usage in one
 * AI surface (chat, migration, whatsapp) cannot starve another (procurement
 * recommendations).
 *
 * Before: PK (tenantId, day)            — single pool, single failure mode
 * After:  PK (tenantId, day, feature)   — independent budgets, isolated blast radius
 *
 * Existing rows are migrated to feature='procurement' (the only consumer up
 * to this migration). Default is set to 'procurement' so any code path that
 * has not yet been updated keeps charging the same bucket as before.
 */
export class AddAiTokenUsageFeatureDimension1780705000000 implements MigrationInterface {
  name = 'AddAiTokenUsageFeatureDimension1780705000000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Add column with safe default — backfills existing rows in one shot.
    await q.query(`
      ALTER TABLE "ai_token_usage"
      ADD COLUMN IF NOT EXISTS "feature" varchar(32) NOT NULL DEFAULT 'procurement'
    `);

    // 2. Swap primary key to include feature. Postgres requires drop+add.
    //    We discover the actual PK name because TypeORM auto-generates it.
    const pkRows = await q.query(`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'ai_token_usage'::regclass AND contype = 'p'
    `);
    const pkName = pkRows?.[0]?.conname;
    if (pkName) {
      await q.query(`ALTER TABLE "ai_token_usage" DROP CONSTRAINT "${pkName}"`);
    }
    await q.query(`
      ALTER TABLE "ai_token_usage"
      ADD CONSTRAINT "pk_ai_token_usage" PRIMARY KEY ("tenantId", "day", "feature")
    `);

    // 3. Replace the old (tenantId, day DESC) index with a feature-aware one.
    await q.query(`DROP INDEX IF EXISTS "idx_ai_token_usage_tenant_day"`);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_token_usage_tenant_day_feature"
        ON "ai_token_usage" ("tenantId", "day" DESC, "feature")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_ai_token_usage_tenant_day_feature"`);

    // Collapse multi-feature rows back into one per (tenantId, day) so the
    // old PK can be restored. Sum across features.
    await q.query(`
      CREATE TEMP TABLE "_ai_token_usage_collapsed" AS
        SELECT "tenantId", "day",
               SUM("inputTokens")::int  AS "inputTokens",
               SUM("outputTokens")::int AS "outputTokens",
               SUM("calls")::int        AS "calls",
               MAX("updatedAt")         AS "updatedAt"
          FROM "ai_token_usage"
         GROUP BY "tenantId", "day"
    `);
    await q.query(`DELETE FROM "ai_token_usage"`);
    await q.query(`ALTER TABLE "ai_token_usage" DROP CONSTRAINT IF EXISTS "pk_ai_token_usage"`);
    await q.query(`ALTER TABLE "ai_token_usage" DROP COLUMN IF EXISTS "feature"`);
    await q.query(`
      ALTER TABLE "ai_token_usage"
      ADD CONSTRAINT "pk_ai_token_usage" PRIMARY KEY ("tenantId", "day")
    `);
    await q.query(`
      INSERT INTO "ai_token_usage" ("tenantId", "day", "inputTokens", "outputTokens", "calls", "updatedAt")
      SELECT "tenantId", "day", "inputTokens", "outputTokens", "calls", "updatedAt"
        FROM "_ai_token_usage_collapsed"
    `);
    await q.query(`DROP TABLE "_ai_token_usage_collapsed"`);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_token_usage_tenant_day"
        ON "ai_token_usage" ("tenantId", "day" DESC)
    `);
  }
}

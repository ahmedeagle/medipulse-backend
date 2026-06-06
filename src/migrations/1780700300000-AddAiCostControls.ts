import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gap #5 — record the exact model + prompt version used to produce each
 * recommendation, so a regulator can reproduce any AI output years later
 * without joining audit logs by timestamp. Nullable because rules-only
 * fallbacks (when GPT is unavailable) legitimately have no model version.
 *
 * Gap #7 — daily per-tenant OpenAI token budget bookkeeping. Counts are
 * incremented atomically inside a single SQL UPSERT during recommendation
 * generation. Indexed on (tenantId, day) for the budget-check fast path.
 */
export class AddAiCostControls1780700300000 implements MigrationInterface {
  name = 'AddAiCostControls1780700300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ai_recommendations" ADD COLUMN IF NOT EXISTS "modelVersion"  varchar(64)`);
    await q.query(`ALTER TABLE "ai_recommendations" ADD COLUMN IF NOT EXISTS "promptVersion" varchar(32)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_token_usage" (
        "tenantId"     uuid        NOT NULL,
        "day"          date        NOT NULL,
        "inputTokens"  integer     NOT NULL DEFAULT 0,
        "outputTokens" integer     NOT NULL DEFAULT 0,
        "calls"        integer     NOT NULL DEFAULT 0,
        "updatedAt"    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("tenantId", "day")
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_token_usage_tenant_day"
        ON "ai_token_usage" ("tenantId", "day" DESC)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_token_usage"`);
    await q.query(`ALTER TABLE "ai_recommendations" DROP COLUMN IF EXISTS "promptVersion"`);
    await q.query(`ALTER TABLE "ai_recommendations" DROP COLUMN IF EXISTS "modelVersion"`);
  }
}

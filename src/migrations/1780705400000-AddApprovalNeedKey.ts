import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Central orchestration: every approval that represents a *single-product
 * business need* (restock Panadol, liquidate near-expiry Aspirin, …) tags
 * itself with a stable `needKey` like `restock::<productId>`. The dedup
 * gate inside ApprovalService uses this key to merge follow-up producers
 * into the first approval as `payload.alternatives[]` rather than creating
 * a second card on the Tasks tab.
 *
 * Before this, the same business event could spawn up to 5 approvals from
 * different agents (low_stock, smart_procurement, procurement_draft,
 * recommendation/REORDER, recommendation/SMART_PROCUREMENT). The pharmacist
 * was paying triage cost N times for the same underlying problem.
 *
 * Partial index keeps the dedup probe on the hot path tight — only open
 * approvals are searched, which is a tiny fraction of the table over time.
 */
export class AddApprovalNeedKey1780705400000 implements MigrationInterface {
  name = 'AddApprovalNeedKey1780705400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "approvals"
        ADD COLUMN IF NOT EXISTS "needKey" varchar(120) NULL
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_approvals_open_need"
        ON "approvals" ("tenantId", "needKey")
        WHERE "status" IN ('pending', 'modified') AND "needKey" IS NOT NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_approvals_open_need"`);
    await q.query(`ALTER TABLE "approvals" DROP COLUMN IF EXISTS "needKey"`);
  }
}

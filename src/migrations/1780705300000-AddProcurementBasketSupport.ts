import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds supplier-basket bundling to procurement drafts.
 *
 * Why: previously each auto-generated draft produced its own approval row.
 * When 3 urgent products all routed to the same supplier, the pharmacist
 * saw 3 separate "purchase" tasks instead of one consolidated supplier PO.
 * That meant: (a) no shipping/bundling consolidation, (b) repeated review
 * effort, (c) visually identical-looking rows when multiple splits existed
 * for the *same* product.
 *
 * The `basketApprovalId` column ties drafts to the composite approval that
 * represents the consolidated PO. The approval-bridge cron uses it to skip
 * already-bundled drafts (idempotency on every 5-minute scan).
 *
 * Partial index keeps the hot path (unbundled, pending drafts) tight even
 * as the table grows — basket assignment is a one-shot event per draft.
 */
export class AddProcurementBasketSupport1780705300000 implements MigrationInterface {
  name = 'AddProcurementBasketSupport1780705300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "procurement_drafts"
        ADD COLUMN IF NOT EXISTS "basketApprovalId" uuid NULL
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_drafts_unbundled_pending"
        ON "procurement_drafts" ("pharmacyTenantId", "supplierTenantId")
        WHERE "status" = 'pending_review' AND "basketApprovalId" IS NULL
    `);

    // ── Data fix: expire stray approvals that were created from cart
    //    (sourceType='ai_plan') drafts before this guard existed. The cart
    //    drawer is the canonical place for those drafts; surfacing them in
    //    the approval queue caused visually duplicated rows whenever a plan
    //    had multiple splits for the same product. Marking the approvals
    //    expired (not deleted) preserves the audit trail.
    await q.query(`
      UPDATE "approvals" a
      SET "status" = 'expired', "updatedAt" = now()
      WHERE a."subjectType" = 'procurement_draft'
        AND a."status" IN ('pending', 'modified')
        AND EXISTS (
          SELECT 1 FROM "procurement_drafts" d
          WHERE d."id" = a."subjectId"
            AND d."sourceType" = 'ai_plan'
        )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_drafts_unbundled_pending"`);
    await q.query(`ALTER TABLE "procurement_drafts" DROP COLUMN IF EXISTS "basketApprovalId"`);
  }
}

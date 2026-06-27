import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Heals the historical duplication of pending `procurement_draft` approvals
 * that appeared in the AI Center as two identical "طلب شراء" cards for the
 * same product/supplier.
 *
 * Root cause: `AddApprovalNeedKey` (1780705400000) added the `needKey` column
 * with a backwards-compatible NULL default. Approvals raised BEFORE that
 * migration ran kept needKey=NULL, so the dedup probe in
 * `ApprovalService.create` (which requires `needKey = :needKey`) never
 * matched them. A second cron tick on the same product then created another
 * approval next to the legacy one.
 *
 * This migration:
 *   1. Backfills `needKey` on existing pending procurement_draft approvals
 *      using `restock::<productId>` (same key the bridge sets today).
 *   2. Collapses duplicates: for each (tenantId, needKey) with >1 pending
 *      approval, keeps the newest and marks the rest as `expired` with a
 *      diagnostic decisionNote.
 *   3. Adds a partial UNIQUE index to prevent the duplicate state from
 *      recurring at the DB level (defence in depth — the service-level
 *      dedup is still the primary control).
 *
 * Idempotent: re-running is a no-op once backfill + dedup are complete.
 */
export class HealDuplicateProcurementApprovals1780705700000 implements MigrationInterface {
  name = 'HealDuplicateProcurementApprovals1780705700000';

  public async up(q: QueryRunner): Promise<void> {
    // 1) Backfill needKey for legacy procurement_draft approvals
    await q.query(`
      UPDATE "approvals"
         SET "needKey" = 'restock::' || ("payload"->>'productId')
       WHERE "needKey" IS NULL
         AND "subjectType" = 'procurement_draft'
         AND "payload"->>'productId' IS NOT NULL
    `);

    // 2) Collapse duplicates: keep newest pending per (tenantId, needKey),
    //    expire the rest. Uses CTE so the cancellation pass sees stable rows.
    await q.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY "tenantId", "needKey"
                 ORDER BY "createdAt" DESC, id DESC
               ) AS rn
          FROM "approvals"
         WHERE "status" IN ('pending','modified')
           AND "needKey" IS NOT NULL
      )
      UPDATE "approvals" a
         SET "status"       = 'expired',
             "decisionNote" = COALESCE(a."decisionNote",'')
                              || ' [auto-collapsed duplicate of newer approval with same needKey]',
             "reviewedAt"   = NOW(),
             "updatedAt"    = NOW()
        FROM ranked r
       WHERE a.id = r.id
         AND r.rn > 1;
    `);

    // 3) DB-level guard so we cannot re-enter this state silently
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_approvals_open_need"
        ON "approvals" ("tenantId", "needKey")
        WHERE "status" IN ('pending','modified') AND "needKey" IS NOT NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uniq_approvals_open_need"`);
    // Backfill + expiry are intentionally not reversible — restoring duplicate
    // pending approvals would just reproduce the original bug. The data is
    // preserved with a clear decisionNote tag for auditability.
  }
}

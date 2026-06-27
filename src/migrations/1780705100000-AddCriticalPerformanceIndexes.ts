import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Targeted indexes for the hot read paths identified during the
 * "Unified Execution & Migration" PRD gap review. All use IF NOT EXISTS
 * so this migration is safe to re-run.
 *
 * What was deliberately NOT added (already covered by entity-level @Index):
 *   - consumption_snapshots(tenantId, productId, weekStart)
 *   - p2p_listings(productId, status)                 (covered, non-partial)
 *   - approvals(tenantId, status, createdAt)          (covered, non-partial)
 *   - financial_ledger_entries(tenant_id, entry_date) (ix_ledger_tenant_date)
 *
 * What this migration adds is the *partial* and *sorted-DESC* variants that
 * Postgres cannot derive from the existing wider indexes.
 */
export class AddCriticalPerformanceIndexes1780705100000 implements MigrationInterface {
  name = 'AddCriticalPerformanceIndexes1780705100000';

  public async up(q: QueryRunner): Promise<void> {
    // Expiry cron + dashboard "expiring soon" widget. Filters by
    // pharmacyTenantId + productId, sorts by expiryDate ASC. Without this,
    // the cron scans the full table for every tenant on every tick.
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_inventory_items_tenant_product_expiry"
        ON "inventory_items" ("pharmacyTenantId", "productId", "expiryDate")
        WHERE "expiryDate" IS NOT NULL
    `);

    // Consumption snapshots — DESC variant of the existing forward index.
    // Spike detection and EOQ always read "most recent N weeks", so the
    // DESC order avoids a sort step.
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_consumption_snapshots_recent"
        ON "consumption_snapshots" ("tenantId", "productId", "weekStart" DESC)
    `);

    // AI Center queue — the single most-hit endpoint in the UI. Partial
    // index keeps it tiny: we only list PENDING approvals on this path.
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_approvals_tenant_pending_created"
        ON "approvals" ("tenantId", "createdAt" DESC)
        WHERE "status" = 'pending'
    `);

    // P2P marketplace "cheapest first" range scan for an active product.
    // The existing (productId, status) index does not include price, so
    // sorting by price still requires a sort step. Partial keeps churn low.
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_listings_product_price_active"
        ON "p2p_listings" ("productId", "price")
        WHERE "status" = 'active'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_p2p_listings_product_price_active"`);
    await q.query(`DROP INDEX IF EXISTS "idx_approvals_tenant_pending_created"`);
    await q.query(`DROP INDEX IF EXISTS "idx_consumption_snapshots_recent"`);
    await q.query(`DROP INDEX IF EXISTS "idx_inventory_items_tenant_product_expiry"`);
  }
}

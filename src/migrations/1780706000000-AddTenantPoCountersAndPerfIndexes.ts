import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three high-impact production fixes bundled together:
 *
 *  1) `tenant_po_counters` table — replaces the `SELECT … FOR UPDATE` row
 *     locks in `PurchasesService.nextPoNumber/nextRpoNumber`. The old
 *     implementation locked **every** row in `purchase_invoices` /
 *     `purchase_returns` for a tenant before computing `MAX(seq)+1`, which
 *     serialized invoice creation across the whole tenant. The new counter
 *     table is a single-row UPSERT with a per-row lock that is held for
 *     microseconds.
 *
 *  2) `idx_inventory_items_upsert_key` — composite covering the upsert
 *     lookup in `upsertInventoryItem` (productId + optional batch +
 *     optional expiry). Every confirmed invoice line previously triggered
 *     a full table scan.
 *
 *  3) `idx_purchase_invoices_tenant` / `idx_purchase_returns_tenant` —
 *     primary tenant-scoped indexes used by every list query and the
 *     downgraded FOR-UPDATE fallback path. Existing entity indexes are
 *     compound (tenantId, status, date) which Postgres won't use for a
 *     pure tenant filter.
 */
export class AddTenantPoCountersAndPerfIndexes1780706000000 implements MigrationInterface {
  name = 'AddTenantPoCountersAndPerfIndexes1780706000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── tenant_po_counters ────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_po_counters" (
        "tenantId"   uuid PRIMARY KEY,
        "lastPo"     integer NOT NULL DEFAULT 0,
        "lastRpo"    integer NOT NULL DEFAULT 0,
        "updatedAt"  timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Backfill so the first INSERT…ON CONFLICT doesn't skip past existing
    // legacy sequences in purchase_invoices / purchase_returns.
    await q.query(`
      INSERT INTO "tenant_po_counters" ("tenantId", "lastPo", "lastRpo", "updatedAt")
      SELECT
        pi."pharmacyTenantId",
        COALESCE(MAX(pi."poSequence"), 0),
        COALESCE(MAX(pr."rpoSequence"), 0),
        now()
      FROM "purchase_invoices" pi
      LEFT JOIN "purchase_returns" pr ON pr."pharmacyTenantId" = pi."pharmacyTenantId"
      GROUP BY pi."pharmacyTenantId"
      ON CONFLICT ("tenantId") DO UPDATE SET
        "lastPo"  = GREATEST("tenant_po_counters"."lastPo",  EXCLUDED."lastPo"),
        "lastRpo" = GREATEST("tenant_po_counters"."lastRpo", EXCLUDED."lastRpo")
    `);

    // ── perf indexes ──────────────────────────────────────────────────
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_purchase_invoices_tenant"
        ON "purchase_invoices" ("pharmacyTenantId")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_purchase_returns_tenant"
        ON "purchase_returns" ("pharmacyTenantId")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_inventory_items_upsert_key"
        ON "inventory_items"
          ("pharmacyTenantId", "productId", "batchNumber", "expiryDate")
        WHERE "deletedAt" IS NULL
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_inventory_items_tenant_product_stock"
        ON "inventory_items" ("pharmacyTenantId", "productId")
        WHERE "deletedAt" IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_inventory_items_tenant_product_stock"`);
    await q.query(`DROP INDEX IF EXISTS "idx_inventory_items_upsert_key"`);
    await q.query(`DROP INDEX IF EXISTS "idx_purchase_returns_tenant"`);
    await q.query(`DROP INDEX IF EXISTS "idx_purchase_invoices_tenant"`);
    await q.query(`DROP TABLE IF EXISTS "tenant_po_counters"`);
  }
}

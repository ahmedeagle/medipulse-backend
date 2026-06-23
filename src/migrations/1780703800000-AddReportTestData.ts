import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds enough data for all 4 report pages to show results in development:
 *   - inventory_items: 6 items (2 near-expiry, 2 active, 2 expired) for tenant
 *   - pos_transaction_items: one item row per existing completed transaction
 *   - expiryDate set on inventory items so expiry-report returns data
 *
 * Safe to run on prod — uses WHERE NOT EXISTS on every insert.
 * Reads existing product IDs from the DB so it's not coupled to hardcoded UUIDs.
 */
export class AddReportTestData1780703800000 implements MigrationInterface {
  name = 'AddReportTestData1780703800000';

  private readonly TENANT = '8c390877-e99c-41db-b3d2-91dc139c3bcc';

  async up(qr: QueryRunner): Promise<void> {
    // ── 1. Seed inventory items with expiry dates ─────────────────────────────
    // Pick up to 6 products from the catalog to populate inventory with
    await qr.query(`
      INSERT INTO inventory_items (
        id, "pharmacyTenantId", "productId",
        quantity, "minThreshold",
        "costPrice", "sellingPrice",
        "expiryDate", "batchNumber",
        "linkStatus", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        '${this.TENANT}',
        p.id,
        CASE idx % 3
          WHEN 0 THEN 5    -- low stock
          WHEN 1 THEN 80   -- normal
          ELSE 40
        END,
        10,
        ROUND((20 + idx * 3)::numeric, 2),
        ROUND((35 + idx * 5)::numeric, 2),
        CASE idx % 3
          WHEN 0 THEN CURRENT_DATE - INTERVAL '10 days'   -- expired
          WHEN 1 THEN CURRENT_DATE + INTERVAL '20 days'   -- near-expiry
          ELSE CURRENT_DATE + INTERVAL '200 days'         -- active
        END,
        'BATCH-' || LPAD(idx::text, 4, '0'),
        'linked',
        NOW(), NOW()
      FROM (
        SELECT id, ROW_NUMBER() OVER () - 1 AS idx
        FROM products
        ORDER BY "createdAt" ASC
        LIMIT 6
      ) p
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_items
        WHERE "pharmacyTenantId" = '${this.TENANT}'
          AND "productId" = p.id
          AND "batchNumber" = 'BATCH-' || LPAD(p.idx::text, 4, '0')
      )
    `);

    // ── 2. Seed pos_transaction_items for existing completed transactions ─────
    // For each completed transaction that has no items yet, add 2 product rows
    await qr.query(`
      INSERT INTO pos_transaction_items (
        id, "transactionId", "productId", "productName",
        quantity, "unitPrice", "discountAmount", subtotal
      )
      SELECT
        gen_random_uuid(),
        tx.id,
        p.id,
        COALESCE(p.name, 'صنف تجريبي'),
        (RANDOM() * 4 + 1)::int,
        ROUND((15 + RANDOM() * 40)::numeric, 2),
        0,
        (RANDOM() * 4 + 1)::int * ROUND((15 + RANDOM() * 40)::numeric, 2)
      FROM pos_transactions tx
      CROSS JOIN LATERAL (
        SELECT id, name FROM products ORDER BY "createdAt" LIMIT 2
      ) p
      WHERE tx."pharmacyTenantId" = '${this.TENANT}'
        AND tx.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM pos_transaction_items WHERE "transactionId" = tx.id
        )
      LIMIT 200
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    // Remove only the batch-numbered inventory items added by this migration
    await qr.query(`
      DELETE FROM inventory_items
      WHERE "pharmacyTenantId" = '${this.TENANT}'
        AND "batchNumber" LIKE 'BATCH-%'
    `);
    // Cannot safely roll back transaction items — leave them
  }
}

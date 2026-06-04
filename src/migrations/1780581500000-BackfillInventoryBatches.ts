import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfills the new multi-batch model from legacy single-row inventory data.
 *
 * For every inventory_items row that has quantity > 0 AND no matching active
 * ProductBatch yet, we create one synthetic batch carrying all of its current
 * stock. This guarantees:
 *   - FEFO ordering, recalls and audit reports work from day one.
 *   - The aggregate recompute in BatchesService is consistent: parent.quantity
 *     equals SUM(active batches.quantity).
 *   - No existing UI / reporting breaks — the legacy fields on inventory_items
 *     stay as the FEFO summary.
 *
 * Idempotent: re-running is safe — only items without a linked active batch
 * are touched, and a stable batchNumber is generated when none exists.
 */
export class BackfillInventoryBatches1780581500000 implements MigrationInterface {
  name = 'BackfillInventoryBatches1780581500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Pre-step: relax NOT NULL constraints that the entity inherited from the
    // first version of the table. Inventory rows without a known expiry are
    // legitimate (unregulated SKUs), and batchNumber is now generated from
    // the legacy id when missing.
    await queryRunner.query(`ALTER TABLE "product_batches" ALTER COLUMN "expiryDate"  DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "product_batches" ALTER COLUMN "batchNumber" DROP NOT NULL`);

    await queryRunner.query(`
      INSERT INTO "product_batches" (
        "id",
        "productId",
        "pharmacyTenantId",
        "inventoryItemId",
        "batchNumber",
        "expiryDate",
        "quantity",
        "receivedQuantity",
        "costPerUnit",
        "sellingPrice",
        "currency",
        "location",
        "status",
        "notes",
        "createdAt",
        "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        i."productId",
        i."pharmacyTenantId",
        i."id",
        COALESCE(NULLIF(i."batchNumber", ''), 'LEGACY-' || SUBSTRING(i."id"::text, 1, 8)),
        i."expiryDate",
        i."quantity",
        i."quantity",
        i."costPrice",
        i."sellingPrice",
        'SAR',
        COALESCE(i."location", 'Main Warehouse'),
        'active',
        'Backfilled from legacy inventory row',
        COALESCE(i."createdAt", now()),
        now()
      FROM "inventory_items" i
      WHERE i."deletedAt" IS NULL
        AND i."quantity" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "product_batches" b
          WHERE b."inventoryItemId" = i."id"
            AND b."status" = 'active'
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only remove rows we created — identified by the marker note.
    await queryRunner.query(
      `DELETE FROM "product_batches" WHERE "notes" = 'Backfilled from legacy inventory row'`,
    );
  }
}

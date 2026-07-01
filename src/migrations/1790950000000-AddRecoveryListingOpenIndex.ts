import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Partial functional index that powers the P2P completion → recovery finalization
 * lookup (RecoveryEventService.finalizeP2pOrderCompletion).
 *
 * On every completed P2P order we must find the seller's still-open projected
 * recovery event for the sold listing. This partial index:
 *   • covers exactly that predicate — (pharmacyTenantId, metadata->>'listingId')
 *     filtered to WHERE status = 'projected' — so the lookup is an index seek, not
 *     a JSONB scan, no matter how large the ledger grows;
 *   • stays tiny — it only holds open projections (one row per active listing),
 *     never the realized order rows, so writes on the hot realized path pay nothing.
 */
export class AddRecoveryListingOpenIndex1790950000000 implements MigrationInterface {
  name = 'AddRecoveryListingOpenIndex1790950000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_recovery_listing_open"
        ON "ai_recovery_events" ("pharmacyTenantId", (("metadata"->>'listingId')))
        WHERE "status" = 'projected'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_recovery_listing_open"`);
  }
}

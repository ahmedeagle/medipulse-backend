import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Performance indexes for P2P marketplace at scale.
 *
 * Key patterns:
 *  - Marketplace search filters by status=active + quantity>0 → partial index
 *  - Seller join on pharmacyTenantId → already covered by seller_profiles PK/unique
 *  - Text search on products.name is handled by existing products table
 *  - expiry + listingType for cron auto-discount scans
 */
export class AddP2pPerformanceIndexes1780700900000 implements MigrationInterface {
  name = 'AddP2pPerformanceIndexes1780700900000';
  // CONCURRENTLY cannot run inside a transaction — TypeORM wraps migrations by default,
  // so we must opt out here.
  transaction = false;

  public async up(qr: QueryRunner): Promise<void> {
    // Partial index: only active listings with stock — primary marketplace scan path
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_p2p_listings_active_marketplace
        ON p2p_listings ("sellerTenantId", price, quantity, "listingType")
        WHERE status = 'active' AND quantity > 0
    `);

    // Expiry-based scan (auto-discount cron + near-expiry filter)
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_p2p_listings_expiry_active
        ON p2p_listings ("expiryDate", status)
        WHERE status = 'active' AND "expiryDate" IS NOT NULL
    `);

    // Orders: seller inbox — pending orders they need to act on
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_p2p_orders_seller_pending
        ON p2p_orders ("sellerTenantId", status, "createdAt" DESC)
        WHERE status = 'pending'
    `);

    // Orders: buyer view (all statuses, newest first)
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_p2p_orders_buyer_created
        ON p2p_orders ("buyerTenantId", "createdAt" DESC)
    `);

    // Reliability scores — join key for marketplace search
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_p2p_reliability_score
        ON seller_reliability_scores ("pharmacyTenantId", "overallScore" DESC)
    `);

    // Seller profiles — marketplace inner join on verificationStatus + isVisible
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seller_profiles_visible_verified
        ON seller_profiles ("pharmacyTenantId", city)
        WHERE "verificationStatus" = 'verified' AND "isVisible" = true
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_p2p_listings_active_marketplace`);
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_p2p_listings_expiry_active`);
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_p2p_orders_seller_pending`);
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_p2p_orders_buyer_created`);
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_p2p_reliability_score`);
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_seller_profiles_visible_verified`);
  }
}

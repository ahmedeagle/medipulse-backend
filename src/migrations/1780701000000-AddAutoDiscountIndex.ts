import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoDiscountIndex1780701000000 implements MigrationInterface {
  name = 'AddAutoDiscountIndex1780701000000';
  transaction = false;

  public async up(qr: QueryRunner): Promise<void> {
    // Auto-discount cron scans: WHERE autoUpdateDiscount=true AND status='active' AND expiryDate IS NOT NULL
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_p2p_listings_auto_discount
        ON p2p_listings ("expiryDate" ASC)
        WHERE "autoUpdateDiscount" = true AND status = 'active' AND "expiryDate" IS NOT NULL
    `);

    // Seller's full order history — all statuses sorted by date
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_p2p_orders_seller_all
        ON p2p_orders ("sellerTenantId", "createdAt" DESC)
    `);

    // Smart procurement service: find active listings for a given productId
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_p2p_listings_product_active
        ON p2p_listings ("productId", price ASC)
        WHERE status = 'active' AND quantity > 0
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_p2p_listings_auto_discount`);
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_p2p_orders_seller_all`);
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_p2p_listings_product_active`);
  }
}

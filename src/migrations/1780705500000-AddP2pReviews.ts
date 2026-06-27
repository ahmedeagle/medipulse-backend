import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * p2p_reviews — buyer-leaves-rating-after-order. Closes the trust-loop gap
 * in the marketplace: seller-reliability was previously system-computed only
 * (acceptanceRate, response speed, fulfillment). With explicit ratings the
 * platform can show buyers a defensible reputation signal, which is the
 * single most-asked question of any B2B marketplace in GCC + Egypt pharma.
 *
 * Design notes:
 *   - One review per order (UNIQUE orderId).
 *   - rating is INT 1..5 with a CHECK constraint (no NUMERIC games).
 *   - Comments are optional, capped at 1000 chars (Arabic counts 1/char in TEXT).
 *   - Indexes target the two read patterns: "list reviews for seller X" and
 *     "compute seller's avg rating over last 90 days".
 */
export class AddP2pReviews1780705500000 implements MigrationInterface {
  name = 'AddP2pReviews1780705500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "p2p_reviews" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderId"        uuid NOT NULL UNIQUE,
        "buyerTenantId"  uuid NOT NULL,
        "sellerTenantId" uuid NOT NULL,
        "rating"         int  NOT NULL,
        "comment"        text NULL,
        "createdAt"      timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "ck_p2p_reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
        CONSTRAINT "ck_p2p_reviews_comment_len"  CHECK ("comment" IS NULL OR length("comment") <= 1000),
        CONSTRAINT "fk_p2p_reviews_order"
          FOREIGN KEY ("orderId") REFERENCES "p2p_orders"("id") ON DELETE CASCADE
      )
    `);

    // Hot path: seller reviews list, newest first
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_reviews_seller_created"
        ON "p2p_reviews" ("sellerTenantId", "createdAt" DESC)
    `);

    // Hot path: 90-day rolling avg for reliability scoring cron
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_reviews_seller_rating"
        ON "p2p_reviews" ("sellerTenantId", "rating")
    `);

    // Buyer "have I already reviewed this order?" check
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_reviews_buyer_created"
        ON "p2p_reviews" ("buyerTenantId", "createdAt" DESC)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_p2p_reviews_buyer_created"`);
    await q.query(`DROP INDEX IF EXISTS "idx_p2p_reviews_seller_rating"`);
    await q.query(`DROP INDEX IF EXISTS "idx_p2p_reviews_seller_created"`);
    await q.query(`DROP TABLE IF EXISTS "p2p_reviews"`);
  }
}

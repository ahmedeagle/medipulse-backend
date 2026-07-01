import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds structured geo-coordinates to seller_profiles.
 *
 * WHY:
 *   The Demand Broadcast feature ("أحتاج دواء") notifies nearby pharmacies that
 *   hold a needed drug. Until now proximity was city-string only — good enough
 *   for a v1, but it cannot rank "nearest first" or enforce a real radius (e.g.
 *   5 km). Structured latitude/longitude unlock Haversine distance ranking so an
 *   urgent/critical need reaches the closest stock-holders first.
 *
 *   Both columns are nullable — a pharmacy that hasn't shared its location still
 *   participates via the existing city match (graceful fallback). numeric(9,6)
 *   gives ~0.1 m precision, far more than needed.
 */
export class AddSellerGeoCoordinates1790800000000 implements MigrationInterface {
  name = 'AddSellerGeoCoordinates1790800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "seller_profiles"
        ADD COLUMN IF NOT EXISTS "latitude"  numeric(9,6) NULL,
        ADD COLUMN IF NOT EXISTS "longitude" numeric(9,6) NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "seller_profiles"
        DROP COLUMN IF EXISTS "longitude",
        DROP COLUMN IF EXISTS "latitude"
    `);
  }
}

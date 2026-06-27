import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarketAvailabilitySnapshots1780704600000 implements MigrationInterface {
  name = 'AddMarketAvailabilitySnapshots1780704600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "market_availability_snapshots" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "productId"        UUID        NOT NULL,
        "availabilityRate" DECIMAL(5,4) NOT NULL,
        "activeSuppliers"  INTEGER     NOT NULL,
        "totalSuppliers"   INTEGER     NOT NULL,
        "lowestActivePrice" DECIMAL(10,2),
        "recordedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Time-series: latest snapshot per product
    await queryRunner.query(`
      CREATE INDEX "idx_market_avail_product_time"
        ON "market_availability_snapshots" ("productId", "recordedAt" DESC)
    `);

    // Alert query: find all at-risk products efficiently
    await queryRunner.query(`
      CREATE INDEX "idx_market_avail_rate"
        ON "market_availability_snapshots" ("availabilityRate", "recordedAt" DESC)
    `);

    // Retention: keep only 90 days of history to bound table size
    await queryRunner.query(`
      COMMENT ON TABLE "market_availability_snapshots" IS
        'Point-in-time market availability per product. Retention: 90 days.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "market_availability_snapshots"`);
  }
}

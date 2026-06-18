import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissedDemand1780703400000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS missed_demand_entries (
        id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId"          UUID         NOT NULL,
        "productId"         UUID,
        "productName"       VARCHAR(255),
        quantity            INT          NOT NULL DEFAULT 1,
        "estimatedLostEgp"  DECIMAL(10,2),
        source              VARCHAR(50)  NOT NULL DEFAULT 'pos_manual',
        "createdAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_missed_demand_tenant  ON missed_demand_entries("tenantId");
      CREATE INDEX IF NOT EXISTS idx_missed_demand_product ON missed_demand_entries("productId");
      CREATE INDEX IF NOT EXISTS idx_missed_demand_created ON missed_demand_entries("createdAt");
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS missed_demand_entries`);
  }
}

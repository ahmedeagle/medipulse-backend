import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerSoftDelete1780702000000 implements MigrationInterface {
  name = 'AddCustomerSoftDelete1780702000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE pos_customers
        ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP DEFAULT NULL
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pos_customers_deleted
        ON pos_customers ("pharmacyTenantId", "deletedAt")
        WHERE "deletedAt" IS NULL
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_pos_customers_deleted`);
    await qr.query(`ALTER TABLE pos_customers DROP COLUMN IF EXISTS "deletedAt"`);
  }
}

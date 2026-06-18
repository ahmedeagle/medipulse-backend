import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddP2pOrdersMissingColumns1780701400000 implements MigrationInterface {
  name = 'AddP2pOrdersMissingColumns1780701400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "p2p_orders"
        ADD COLUMN IF NOT EXISTS "urgencyLevel"       varchar(10) NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS "expectedDeliveryAt" timestamp,
        ADD COLUMN IF NOT EXISTS "shippedAt"          timestamp,
        ADD COLUMN IF NOT EXISTS "deliveryNote"       text
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "p2p_orders"."urgencyLevel"
        IS 'normal | urgent | critical'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_orders_urgency"
        ON "p2p_orders" ("urgencyLevel", "status", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_p2p_orders_urgency"`);
    await queryRunner.query(`
      ALTER TABLE "p2p_orders"
        DROP COLUMN IF EXISTS "urgencyLevel",
        DROP COLUMN IF EXISTS "expectedDeliveryAt",
        DROP COLUMN IF EXISTS "shippedAt",
        DROP COLUMN IF EXISTS "deliveryNote"
    `);
  }
}

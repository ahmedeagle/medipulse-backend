import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryDiscoverySetting1780701500000 implements MigrationInterface {
  name = 'AddInventoryDiscoverySetting1780701500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pharmacy_settings"
        ADD COLUMN IF NOT EXISTS "allowInventoryDiscovery" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pharmacy_settings_inventory_discovery"
        ON "pharmacy_settings" ("allowInventoryDiscovery")
        WHERE "allowInventoryDiscovery" = true
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "pharmacy_settings"."allowInventoryDiscovery"
        IS 'When true, other pharmacies can find this pharmacy''s live inventory via Need Now search (availability only, no prices exposed)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pharmacy_settings_inventory_discovery"`);
    await queryRunner.query(`
      ALTER TABLE "pharmacy_settings"
        DROP COLUMN IF EXISTS "allowInventoryDiscovery"
    `);
  }
}

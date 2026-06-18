import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSellerProfileExtraColumns1780701100000 implements MigrationInterface {
  name = 'AddSellerProfileExtraColumns1780701100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 4 additional document URL columns
    await queryRunner.query(`
      ALTER TABLE "seller_profiles"
        ADD COLUMN IF NOT EXISTS "pharmacistLicenseUrl" text,
        ADD COLUMN IF NOT EXISTS "licenseHolderIdUrl"   text,
        ADD COLUMN IF NOT EXISTS "municipalPermitUrl"   text,
        ADD COLUMN IF NOT EXISTS "vatCertUrl"           text
    `);

    // Country field
    await queryRunner.query(`
      ALTER TABLE "seller_profiles"
        ADD COLUMN IF NOT EXISTS "country" varchar(100)
    `);

    // Automation and notification preference blobs
    await queryRunner.query(`
      ALTER TABLE "seller_profiles"
        ADD COLUMN IF NOT EXISTS "automations"        jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "notificationPrefs"  jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "seller_profiles"
        DROP COLUMN IF EXISTS "pharmacistLicenseUrl",
        DROP COLUMN IF EXISTS "licenseHolderIdUrl",
        DROP COLUMN IF EXISTS "municipalPermitUrl",
        DROP COLUMN IF EXISTS "vatCertUrl",
        DROP COLUMN IF EXISTS "country",
        DROP COLUMN IF EXISTS "automations",
        DROP COLUMN IF EXISTS "notificationPrefs"
    `);
  }
}

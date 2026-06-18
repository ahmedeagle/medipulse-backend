import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPharmacySettings1780701200000 implements MigrationInterface {
  name = 'AddPharmacySettings1780701200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pharmacy_settings" (
        "id"                  uuid                NOT NULL DEFAULT gen_random_uuid(),
        "pharmacyTenantId"    varchar             NOT NULL,
        "language"            varchar             NOT NULL DEFAULT 'ar',
        "currency"            varchar             NOT NULL DEFAULT 'EGP',
        "timezone"            varchar             NOT NULL DEFAULT 'Africa/Cairo',
        "dateFormat"          varchar             NOT NULL DEFAULT 'YYYY-MM-DD',
        "timeFormat"          varchar             NOT NULL DEFAULT '12h',
        "taxEnabled"          boolean             NOT NULL DEFAULT true,
        "pharmacyNameAr"      varchar,
        "pharmacyNameEn"      varchar,
        "licenseNumber"       varchar,
        "pharmacyType"        varchar             NOT NULL DEFAULT 'retail',
        "phone"               varchar,
        "contactEmail"        varchar,
        "country"             varchar,
        "city"                varchar,
        "region"              varchar,
        "address"             varchar,
        "gpsLocation"         varchar,
        "logoUrl"             varchar,
        "receiptSettings"     jsonb               NOT NULL DEFAULT '{}',
        "labelSettings"       jsonb               NOT NULL DEFAULT '{}',
        "inventorySettings"   jsonb               NOT NULL DEFAULT '{}',
        "aiAnalysisSettings"  jsonb               NOT NULL DEFAULT '{}',
        "updatedAt"           TIMESTAMP           NOT NULL DEFAULT now(),
        "createdAt"           TIMESTAMP           NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pharmacy_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pharmacy_settings_tenant" UNIQUE ("pharmacyTenantId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pharmacy_settings_tenant"
        ON "pharmacy_settings" ("pharmacyTenantId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pharmacy_settings"`);
  }
}

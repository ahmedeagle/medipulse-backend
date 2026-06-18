import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddP2pSellerProfiles1780700500000 implements MigrationInterface {
  name = 'AddP2pSellerProfiles1780700500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "seller_profiles" (
        "id"                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "pharmacyTenantId"     uuid NOT NULL UNIQUE,
        "legalName"            varchar(255) NOT NULL,
        "gpsLocation"          varchar(100),
        "city"                 varchar(100),
        "region"               varchar(100),
        "address"              text,
        "pharmacyLicenseUrl"   text,
        "commercialRegUrl"     text,
        "taxDocUrl"            text,
        "deliveryZones"        jsonb NOT NULL DEFAULT '[]'::jsonb,
        "isVisible"            boolean NOT NULL DEFAULT true,
        "verificationStatus"   varchar(20) NOT NULL DEFAULT 'pending',
        "rejectionReason"      text,
        "lastLegalAckAt"       timestamp,
        "updatedAt"            timestamp NOT NULL DEFAULT now(),
        "createdAt"            timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_seller_profiles_tenant"
        ON "seller_profiles" ("pharmacyTenantId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_seller_profiles_status"
        ON "seller_profiles" ("verificationStatus")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_seller_profiles_city"
        ON "seller_profiles" ("city")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "seller_reliability_scores" (
        "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "pharmacyTenantId"  uuid NOT NULL UNIQUE,
        "acceptanceRate"    decimal(5,4) NOT NULL DEFAULT 0,
        "avgResponseMinutes" decimal(8,2) NOT NULL DEFAULT 0,
        "fulfillmentRate"   decimal(5,4) NOT NULL DEFAULT 0,
        "sampleSize"        int NOT NULL DEFAULT 0,
        "overallScore"      decimal(5,2) NOT NULL DEFAULT 0,
        "label"             varchar(10) NOT NULL DEFAULT 'low',
        "trustLevel"        varchar(10) NOT NULL DEFAULT 'bronze',
        "lastCalculatedAt"  timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_seller_scores_tenant"
        ON "seller_reliability_scores" ("pharmacyTenantId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_seller_scores_overall"
        ON "seller_reliability_scores" ("overallScore" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "seller_reliability_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "seller_profiles"`);
  }
}

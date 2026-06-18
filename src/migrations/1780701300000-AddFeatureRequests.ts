import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeatureRequests1780701300000 implements MigrationInterface {
  name = 'AddFeatureRequests1780701300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feature_requests" (
        "id"                    uuid          NOT NULL DEFAULT gen_random_uuid(),
        "trackingNumber"        varchar(20)   NOT NULL,
        "tenantId"              uuid          NOT NULL,
        "submittedByUserId"     uuid,
        "question"              text          NOT NULL,
        "hint"                  text,
        "priority"              varchar(10)   NOT NULL DEFAULT 'medium',
        "status"                varchar(20)   NOT NULL DEFAULT 'open',
        "assignedToUserId"      uuid,
        "resolution"            text,
        "createdAt"             timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"             timestamptz   NOT NULL DEFAULT now(),
        "resolvedAt"            timestamptz,
        CONSTRAINT "PK_feature_requests" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_feature_requests_trackingNumber" UNIQUE ("trackingNumber")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fr_tenant_status"
        ON "feature_requests" ("tenantId", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fr_assigned"
        ON "feature_requests" ("assignedToUserId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fr_assigned"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fr_tenant_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "feature_requests"`);
  }
}

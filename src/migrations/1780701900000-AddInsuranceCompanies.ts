import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInsuranceCompanies1780701900000 implements MigrationInterface {
  name = 'AddInsuranceCompanies1780701900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE insurance_companies (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        "pharmacyTenantId" UUID NOT NULL,
        name VARCHAR(150) NOT NULL,
        "patientPercent" DECIMAL(5,2) NOT NULL DEFAULT 20,
        notes TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_insurance_companies_tenant ON insurance_companies("pharmacyTenantId")
    `);

    await queryRunner.query(`
      ALTER TABLE pos_customers
        ADD COLUMN IF NOT EXISTS "insuranceCompanyId" UUID,
        ADD COLUMN IF NOT EXISTS "insuranceCardNumber" VARCHAR(60),
        ADD COLUMN IF NOT EXISTS "insurancePolicyNumber" VARCHAR(60),
        ADD COLUMN IF NOT EXISTS "copayPercent" DECIMAL(5,2)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pos_customers
        DROP COLUMN IF EXISTS "copayPercent",
        DROP COLUMN IF EXISTS "insurancePolicyNumber",
        DROP COLUMN IF EXISTS "insuranceCardNumber",
        DROP COLUMN IF EXISTS "insuranceCompanyId"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS insurance_companies`);
  }
}

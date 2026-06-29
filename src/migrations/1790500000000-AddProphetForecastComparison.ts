import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * prophet_forecast_comparison — shadow-mode log comparing the live Holt-Winters
 * forecast against the external Prophet microservice. Never feeds live logic.
 */
export class AddProphetForecastComparison1790500000000 implements MigrationInterface {
  name = 'AddProphetForecastComparison1790500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "prophet_forecast_comparison" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId"           uuid NOT NULL,
        "productId"          uuid NOT NULL,
        "forecastDate"       date NOT NULL,
        "horizonDays"        int NOT NULL,
        "holtQty"            numeric(10,2) NOT NULL,
        "holtCiLow"          numeric(10,2) NULL,
        "holtCiHigh"         numeric(10,2) NULL,
        "prophetQty"         numeric(10,2) NOT NULL,
        "prophetCiLow"       numeric(10,2) NULL,
        "prophetCiHigh"      numeric(10,2) NULL,
        "prophetTrend"       varchar(20) NULL,
        "trainingDataPoints" int NOT NULL DEFAULT 0,
        "diffRatio"          numeric(8,4) NULL,
        "actualQty"          numeric(10,2) NULL,
        "holtMape"           numeric(6,4) NULL,
        "prophetMape"        numeric(6,4) NULL,
        "status"             varchar(20) NOT NULL DEFAULT 'shadow',
        "createdAt"          timestamp NOT NULL DEFAULT NOW()
      )
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_prophet_cmp_unique"
        ON "prophet_forecast_comparison" ("tenantId", "productId", "forecastDate", "horizonDays")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_prophet_cmp_tenant_product"
        ON "prophet_forecast_comparison" ("tenantId", "productId")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_prophet_cmp_tenant_product"`);
    await q.query(`DROP INDEX IF EXISTS "uq_prophet_cmp_unique"`);
    await q.query(`DROP TABLE IF EXISTS "prophet_forecast_comparison"`);
  }
}

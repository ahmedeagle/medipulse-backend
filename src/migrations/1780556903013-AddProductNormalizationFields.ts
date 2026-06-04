import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductNormalizationFields1780556903013 implements MigrationInterface {
    name = 'AddProductNormalizationFields1780556903013'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "inventory_reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "supplier_tenant_id" character varying NOT NULL, "product_id" character varying NOT NULL, "reserved_for_tenant_id" character varying NOT NULL, "quantity" integer NOT NULL, "order_id" character varying, "status" character varying(20) NOT NULL DEFAULT 'pending', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_af438c0ce596eea6c4d472a0489" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_reservation_expires" ON "inventory_reservations" ("expires_at") `);
        await queryRunner.query(`CREATE INDEX "ix_reservation_status" ON "inventory_reservations" ("status") `);
        await queryRunner.query(`CREATE INDEX "ix_reservation_supplier_product" ON "inventory_reservations" ("supplier_tenant_id", "product_id") `);
        await queryRunner.query(`CREATE TABLE "supplier_settlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "supplier_tenant_id" character varying NOT NULL, "period_start" date NOT NULL, "period_end" date NOT NULL, "total_gross" numeric(15,2) NOT NULL DEFAULT '0', "total_returns" numeric(15,2) NOT NULL DEFAULT '0', "total_credits" numeric(15,2) NOT NULL DEFAULT '0', "net_amount" numeric(15,2) NOT NULL DEFAULT '0', "currency" character varying(3) NOT NULL DEFAULT 'SAR', "order_count" integer NOT NULL DEFAULT '0', "status" character varying(20) NOT NULL DEFAULT 'pending', "settlement_reference" character varying(100), "settled_at" TIMESTAMP WITH TIME ZONE, "approved_by" character varying(64), "dispute_reason" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fc9df8b2b4cef3992a752f34ca4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_settlement_supplier" ON "supplier_settlements" ("supplier_tenant_id", "period_start") `);
        await queryRunner.query(`CREATE TABLE "payment_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" character varying NOT NULL, "pharmacy_tenant_id" character varying NOT NULL, "supplier_tenant_id" character varying NOT NULL, "amount" numeric(15,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'SAR', "payment_method" character varying(30) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'initiated', "reference_number" character varying(100), "settled_at" TIMESTAMP WITH TIME ZONE, "failure_reason" text, "ledger_entry_id" character varying, "initiated_by" character varying(64) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d32b3c6b0d2c1d22604cbcc8c49" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_payment_supplier" ON "payment_transactions" ("supplier_tenant_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "ix_payment_pharmacy" ON "payment_transactions" ("pharmacy_tenant_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "ix_payment_order" ON "payment_transactions" ("order_id") `);
        await queryRunner.query(`CREATE TABLE "financial_ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" character varying NOT NULL, "account_type" character varying(20) NOT NULL, "debit_amount" numeric(15,2), "credit_amount" numeric(15,2), "currency" character varying(3) NOT NULL DEFAULT 'SAR', "reference_type" character varying(30) NOT NULL, "reference_id" character varying NOT NULL, "description" text NOT NULL, "entry_date" date NOT NULL, "reversal_of_id" character varying, "reversed_by_id" character varying, "correlation_id" character varying(64), "posted_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2d551ad34ef4290d4bdb501bce8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_ledger_account_tenant" ON "financial_ledger_entries" ("account_type", "tenant_id") `);
        await queryRunner.query(`CREATE INDEX "ix_ledger_reference" ON "financial_ledger_entries" ("reference_type", "reference_id") `);
        await queryRunner.query(`CREATE INDEX "ix_ledger_tenant_date" ON "financial_ledger_entries" ("tenant_id", "entry_date") `);
        await queryRunner.query(`CREATE TABLE "credit_wallets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" character varying NOT NULL, "credit_limit" numeric(15,2) NOT NULL DEFAULT '0', "utilized_credit" numeric(15,2) NOT NULL DEFAULT '0', "currency" character varying(3) NOT NULL DEFAULT 'SAR', "status" character varying(20) NOT NULL DEFAULT 'active', "expires_at" date, "utilization_alert_threshold" numeric(4,2) NOT NULL DEFAULT '0.8', "suspension_reason" text, "approved_by" character varying(64), "approved_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a1045d872eb4ecdc496daa8e587" UNIQUE ("tenant_id"), CONSTRAINT "PK_8b18298d800c7504182b7a227d2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ix_credit_wallet_tenant" ON "credit_wallets" ("tenant_id") `);
        await queryRunner.query(`ALTER TABLE "products" ADD "sfdaRegistration" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "products" ADD "edaRegistration" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "products" ADD "mohapRegistration" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "products" ADD "jfdaRegistration" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "vatRate" SET DEFAULT '0.15'`);
        await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "vatRate" SET DEFAULT '0.15'`);
        await queryRunner.query(`ALTER TABLE "procurement_schedules" ALTER COLUMN "serviceLevel" SET DEFAULT '0.95'`);
        await queryRunner.query(`ALTER TYPE "public"."ai_recommendations_type_enum" RENAME TO "ai_recommendations_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."ai_recommendations_type_enum" AS ENUM('reorder', 'price_comparison', 'alternative', 'dead_stock_alert', 'consumption_spike', 'forecast_alert', 'liquidation', 'reorder_schedule', 'insufficient_data')`);
        await queryRunner.query(`ALTER TABLE "ai_recommendations" ALTER COLUMN "type" TYPE "public"."ai_recommendations_type_enum" USING "type"::"text"::"public"."ai_recommendations_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."ai_recommendations_type_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."ai_recommendations_type_enum_old" AS ENUM('reorder', 'price_comparison', 'alternative', 'dead_stock_alert', 'consumption_spike', 'forecast_alert', 'liquidation', 'reorder_schedule')`);
        await queryRunner.query(`ALTER TABLE "ai_recommendations" ALTER COLUMN "type" TYPE "public"."ai_recommendations_type_enum_old" USING "type"::"text"::"public"."ai_recommendations_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."ai_recommendations_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."ai_recommendations_type_enum_old" RENAME TO "ai_recommendations_type_enum"`);
        await queryRunner.query(`ALTER TABLE "procurement_schedules" ALTER COLUMN "serviceLevel" SET DEFAULT 0.95`);
        await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "vatRate" SET DEFAULT 0.15`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "vatRate" SET DEFAULT 0.15`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "jfdaRegistration"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "mohapRegistration"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "edaRegistration"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "sfdaRegistration"`);
        await queryRunner.query(`DROP INDEX "public"."ix_credit_wallet_tenant"`);
        await queryRunner.query(`DROP TABLE "credit_wallets"`);
        await queryRunner.query(`DROP INDEX "public"."ix_ledger_tenant_date"`);
        await queryRunner.query(`DROP INDEX "public"."ix_ledger_reference"`);
        await queryRunner.query(`DROP INDEX "public"."ix_ledger_account_tenant"`);
        await queryRunner.query(`DROP TABLE "financial_ledger_entries"`);
        await queryRunner.query(`DROP INDEX "public"."ix_payment_order"`);
        await queryRunner.query(`DROP INDEX "public"."ix_payment_pharmacy"`);
        await queryRunner.query(`DROP INDEX "public"."ix_payment_supplier"`);
        await queryRunner.query(`DROP TABLE "payment_transactions"`);
        await queryRunner.query(`DROP INDEX "public"."ix_settlement_supplier"`);
        await queryRunner.query(`DROP TABLE "supplier_settlements"`);
        await queryRunner.query(`DROP INDEX "public"."ix_reservation_supplier_product"`);
        await queryRunner.query(`DROP INDEX "public"."ix_reservation_status"`);
        await queryRunner.query(`DROP INDEX "public"."ix_reservation_expires"`);
        await queryRunner.query(`DROP TABLE "inventory_reservations"`);
    }

}

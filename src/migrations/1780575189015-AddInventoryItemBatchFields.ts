import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInventoryItemBatchFields1780575189015 implements MigrationInterface {
    name = 'AddInventoryItemBatchFields1780575189015'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // inventory_items new columns
        await queryRunner.query(`ALTER TABLE "inventory_items" ADD IF NOT EXISTS "batchNumber" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "inventory_items" ADD IF NOT EXISTS "location" character varying(100) DEFAULT 'Main Warehouse'`);
        await queryRunner.query(`ALTER TABLE "inventory_items" ADD IF NOT EXISTS "costPrice" numeric(10,2)`);
        await queryRunner.query(`ALTER TABLE "inventory_items" ADD IF NOT EXISTS "sellingPrice" numeric(10,2)`);
        // default changes (idempotent)
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "vatRate" SET DEFAULT '0.15'`);
        await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "vatRate" SET DEFAULT '0.15'`);
        await queryRunner.query(`ALTER TABLE "procurement_schedules" ALTER COLUMN "serviceLevel" SET DEFAULT '0.95'`);
        await queryRunner.query(`ALTER TABLE "credit_wallets" ALTER COLUMN "utilization_alert_threshold" SET DEFAULT '0.8'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "credit_wallets" ALTER COLUMN "utilization_alert_threshold" SET DEFAULT 0.8`);
        await queryRunner.query(`ALTER TABLE "procurement_schedules" ALTER COLUMN "serviceLevel" SET DEFAULT 0.95`);
        await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "vatRate" SET DEFAULT 0.15`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "vatRate" SET DEFAULT 0.15`);
        await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "sellingPrice"`);
        await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "costPrice"`);
        await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "location"`);
        await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "batchNumber"`);
    }
}

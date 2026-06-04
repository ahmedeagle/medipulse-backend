import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductNameArSku1780572727946 implements MigrationInterface {
    name = 'AddProductNameArSku1780572727946'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" ADD "nameAr" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "products" ADD "sku" character varying(100)`);
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
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "sku"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "nameAr"`);
    }

}

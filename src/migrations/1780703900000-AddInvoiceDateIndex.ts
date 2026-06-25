import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceDateIndex1780703900000 implements MigrationInterface {
  name = 'AddInvoiceDateIndex1780703900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchase_invoices_tenant_invoice_date"
      ON purchase_invoices ("pharmacyTenantId", "invoiceDate")
      WHERE "deletedAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_purchase_invoices_tenant_invoice_date"
    `);
  }
}

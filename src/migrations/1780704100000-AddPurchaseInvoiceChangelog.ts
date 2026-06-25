import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurchaseInvoiceChangelog1780704100000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_invoices
        ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'manual'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS purchase_invoice_changelogs (
        id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        "invoiceId"  uuid NOT NULL,
        "tenantId"   uuid NOT NULL,
        "userId"     uuid,
        action       varchar(30) NOT NULL,
        changes      jsonb NOT NULL DEFAULT '[]',
        "createdAt"  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pic_invoice_created"
        ON purchase_invoice_changelogs ("invoiceId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pic_tenant_created"
        ON purchase_invoice_changelogs ("tenantId", "createdAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_invoice_changelogs`);
    await queryRunner.query(`ALTER TABLE purchase_invoices DROP COLUMN IF EXISTS source`);
  }
}

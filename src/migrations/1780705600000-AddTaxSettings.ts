import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-tenant tax/VAT calculation preferences to pharmacy_settings.
 *
 * Why a setting (not a hard-coded rule):
 *   Medipulse is multi-jurisdiction SaaS. VAT-on-discount handling differs
 *   between Egypt (tax on net after invoice-level discount) and some KSA /
 *   legacy ERP contracts (tax on gross before invoice-level discount).
 *
 *   Default = 'tax_on_net'  → matches Egyptian VAT Law no. 67/2016 art. 11
 *                              and the GCC VAT Framework Agreement default.
 *   'tax_on_gross'          → opt-in for tenants whose accountant explicitly
 *                              requires it (legacy KSA pre-2020 contracts,
 *                              some commercial-discount-vs-trade-discount
 *                              distinctions).
 *
 * Stored as jsonb so we can add taxRegistrationNumber, withholdingPct, etc.
 * without further migrations.
 */
export class AddTaxSettings1780705600000 implements MigrationInterface {
  name = 'AddTaxSettings1780705600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pharmacy_settings
        ADD COLUMN IF NOT EXISTS "taxSettings" jsonb NOT NULL DEFAULT '{}'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pharmacy_settings DROP COLUMN IF EXISTS "taxSettings"
    `);
  }
}

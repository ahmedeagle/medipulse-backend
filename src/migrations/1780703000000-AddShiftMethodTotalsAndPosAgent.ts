import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShiftMethodTotalsAndPosAgent1780703000000 implements MigrationInterface {
  name = 'AddShiftMethodTotalsAndPosAgent1780703000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Per-method shift totals
    await queryRunner.query(`
      ALTER TABLE pos_shifts
        ADD COLUMN IF NOT EXISTS "totalCashSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalCardSales" DECIMAL(12,2) NOT NULL DEFAULT 0
    `);

    // POS Integrity Agent definition
    await queryRunner.query(`
      INSERT INTO agent_definitions (
        id, code, "nameEn", "nameAr", category,
        "descriptionEn", "descriptionAr",
        skills, "outputTypes",
        "defaultEnabled", "minConfidence", "requiresApproval",
        phase, "iconKey", "isCustom", "tenantScope",
        "createdAt", "updatedAt"
      )
      SELECT
        uuid_generate_v4(),
        'pos_integrity',
        'POS Integrity Agent',
        'وكيل سلامة نقطة البيع',
        'pos',
        'Monitors POS shifts for cash mismatches, fraud patterns, unusual voids and refund abuse',
        'يراقب شفتات نقطة البيع ويكشف تلاعبات الكاش والخصومات المشبوهة والمرتجعات غير الطبيعية',
        '["cash_reconciliation","fraud_detection","shift_analysis","refund_monitoring"]',
        '["pos_shift_action"]',
        true, 0.70, true,
        1, 'shield-alert', false, 'global',
        NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_definitions WHERE code = 'pos_integrity'
      )
    `);

    // Cash Reconciliation Agent definition
    await queryRunner.query(`
      INSERT INTO agent_definitions (
        id, code, "nameEn", "nameAr", category,
        "descriptionEn", "descriptionAr",
        skills, "outputTypes",
        "defaultEnabled", "minConfidence", "requiresApproval",
        phase, "iconKey", "isCustom", "tenantScope",
        "createdAt", "updatedAt"
      )
      SELECT
        uuid_generate_v4(),
        'cash_reconciliation',
        'Cash Reconciliation Agent',
        'وكيل مطابقة الكاش',
        'pos',
        'Compares declared closing cash versus system-computed expected balance and flags discrepancies',
        'يقارن الرصيد الختامي المُعلن مع الرصيد المحسوب من النظام ويرفع تنبيهات عند أي فرق',
        '["cash_audit","variance_detection","shift_reconciliation"]',
        '["pos_shift_action"]',
        true, 0.80, true,
        1, 'banknote', false, 'global',
        NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_definitions WHERE code = 'cash_reconciliation'
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pos_shifts DROP COLUMN IF EXISTS "totalCashSales", DROP COLUMN IF EXISTS "totalCardSales"`);
    await queryRunner.query(`DELETE FROM agent_definitions WHERE code IN ('pos_integrity','cash_reconciliation')`);
  }
}

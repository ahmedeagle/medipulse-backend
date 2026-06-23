import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLowStockAgent1780703200000 implements MigrationInterface {
  name = 'AddLowStockAgent1780703200000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      INSERT INTO agent_definitions (
        code, "nameEn", "nameAr", category,
        "descriptionEn", "descriptionAr",
        skills, permissions, restrictions, "outputTypes",
        "defaultEnabled", "minConfidence", "requiresApproval", phase, "iconKey"
      )
      SELECT
        'low_stock_replenishment',
        'Low Stock Replenishment',
        'مراقب نقص المخزون',
        'inventory',
        'Detects inventory items below minimum threshold and guides the pharmacist to replenish via P2P marketplace or procurement.',
        'يرصد المنتجات التي وصل مخزونها للحد الأدنى ويوجّه الصيدلاني للتجديد عبر البورصة الدوائية أو المشتريات.',
        '["stock_monitoring","p2p_availability_check","procurement_guidance"]'::jsonb,
        '["read:inventory","read:p2p_listings"]'::jsonb,
        '["no_auto_order","no_price_changes"]'::jsonb,
        '["replenishment_guidance","p2p_redirect","procurement_redirect"]'::jsonb,
        true, 0.75, true, 1, 'alert-circle'
      WHERE NOT EXISTS (SELECT 1 FROM agent_definitions WHERE code = 'low_stock_replenishment')
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(
      `DELETE FROM agent_definitions WHERE code = 'low_stock_replenishment'`,
    );
  }
}

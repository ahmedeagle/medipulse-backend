import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLostRevenueAgent1780703300000 implements MigrationInterface {
  name = 'AddLostRevenueAgent1780703300000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      INSERT INTO agent_definitions (
        code, "nameEn", "nameAr", category,
        "descriptionEn", "descriptionAr",
        skills, permissions, restrictions, "outputTypes",
        enabled, "minConfidence", "requiresApproval", phase, "iconKey"
      )
      VALUES (
        'lost_revenue_detector',
        'Lost Revenue Detector',
        'كاشف الخسائر الخفية',
        'inventory',
        'Detects revenue leaking from stockouts by comparing zero-inventory periods against historical demand velocity. Quantifies daily and cumulative EGP loss.',
        'يرصد الخسائر المالية الناتجة عن نفاد المخزون بمقارنة فترات الصفر مع سرعة الطلب التاريخية. يحسب الخسارة اليومية والتراكمية بالجنيه.',
        '["stockout_detection","demand_velocity_analysis","revenue_estimation"]'::jsonb,
        '["read:inventory","read:consumption_snapshots","read:p2p_listings","read:supplier_catalog"]'::jsonb,
        '["no_auto_order","no_price_changes"]'::jsonb,
        '["lost_revenue_alert","procurement_guidance","p2p_redirect"]'::jsonb,
        true, 0.85, true, 1, 'banknote'
      )
      ON CONFLICT (code) DO NOTHING
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(
      `DELETE FROM agent_definitions WHERE code = 'lost_revenue_detector'`,
    );
  }
}

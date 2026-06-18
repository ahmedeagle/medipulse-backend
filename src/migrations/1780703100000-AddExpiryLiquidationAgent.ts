import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpiryLiquidationAgent1780703100000 implements MigrationInterface {
  name = 'AddExpiryLiquidationAgent1780703100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Seed the expiry_liquidation agent definition
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
        'expiry_liquidation',
        'Expiry Liquidation Agent',
        'مصفاة الانتهاء الذكية',
        'marketplace',
        'Detects near-expiry inventory (≤90 days) and automatically creates clearance listing suggestions on the P2P marketplace with AI-calculated discounts.',
        'يرصد المخزون قريب الانتهاء (أقل من 90 يوم) ويقترح تلقائياً عروض تصفية في سوق التبادل بأسعار مخفضة محسوبة ذكياً لاسترداد أقصى قيمة قبل الهلاك.',
        '["expiry_monitoring","price_optimization","clearance_listing"]',
        '["expiry_liquidation"]',
        true, 0.70, true,
        1, 'PackageOpen', false, 'global',
        NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_definitions WHERE code = 'expiry_liquidation'
      )
    `);

    // 2. Add clearance_listing_available notification type to the enum (if using PostgreSQL enum)
    //    The NotificationType is a TypeScript union / varchar(50) in code — no DB enum change needed.
    //    This comment serves as documentation for the new type value.
    //    Type: 'clearance_listing_available' — sent to buyer pharmacies when a clearance listing
    //    goes live for a product they have purchased before or are low on.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM agent_definitions WHERE code = 'expiry_liquidation'
    `);
  }
}

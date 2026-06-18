import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddP2pMonitorAgent1780701600000 implements MigrationInterface {
  name = 'AddP2pMonitorAgent1780701600000';

  async up(queryRunner: QueryRunner): Promise<void> {
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
        'p2p_monitor',
        'P2P Order Monitor',
        'مراقب الطلبات',
        'marketplace',
        'Detects stale P2P orders and recommends lifecycle actions (cancel, confirm, remind)',
        'يراقب طلبات التداول بين الصيدليات ويقترح إجراءات لمعالجة الطلبات المتأخرة أو المتوقفة',
        '["order_lifecycle_monitoring","deadline_detection","escalation"]',
        '["p2p_order_action"]',
        true, 0.65, true,
        1, 'ShoppingCart', false, 'global',
        NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_definitions WHERE code = 'p2p_monitor'
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM agent_definitions WHERE code = 'p2p_monitor'
    `);
  }
}

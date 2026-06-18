-- Seed p2p_monitor and pos_integrity agent definitions
-- Run once against the database: psql $DATABASE_URL -f seed_p2p_pos_agents.sql

INSERT INTO agent_definitions (
  code, "nameEn", "nameAr", category,
  "descriptionEn", "descriptionAr",
  skills, permissions, restrictions, "outputTypes",
  "defaultEnabled", "minConfidence", "requiresApproval",
  phase, "iconKey", "outputSubjectType", "outputSchema",
  "triggerRules", version, "isCustom", "tenantScope"
)
VALUES
(
  'p2p_monitor',
  'P2P Order Monitor',
  'مراقب طلبات البورصة الدوائية',
  'marketplace',
  'Detects stale P2P orders (no response, not shipped, receipt pending, expiry warning) and recommends lifecycle actions.',
  'يراقب طلبات تبادل الأدوية ويكتشف الطلبات المتوقفة ويقترح إجراءات لإنهائها.',
  '["order_lifecycle_monitoring","deadline_detection"]'::jsonb,
  '["read_p2p_orders","cancel_p2p_order","complete_p2p_order","send_notification"]'::jsonb,
  '["no_auto_execute_above_threshold"]'::jsonb,
  '["p2p_order_action"]'::jsonb,
  true,
  0.65,
  true,
  1,
  'shopping-cart',
  'p2p_order_action',
  '{}'::jsonb,
  '{}'::jsonb,
  1,
  false,
  'global'
),
(
  'pos_integrity',
  'POS Integrity Monitor',
  'مراقب سلامة الكاشير',
  'pos',
  'Analyzes closed POS shifts for cash mismatches and high refund rates, and surfaces them for manager review.',
  'يحلل الشفتات المغلقة في نقطة البيع لاكتشاف الفوارق النقدية ومعدلات المرتجعات غير الطبيعية.',
  '["shift_analysis","cash_reconciliation","refund_rate_detection"]'::jsonb,
  '["read_pos_shifts","read_pos_transactions","send_notification"]'::jsonb,
  '["no_auto_execute","acknowledgement_only"]'::jsonb,
  '["pos_shift_action"]'::jsonb,
  true,
  0.60,
  true,
  1,
  'shield-check',
  'pos_shift_action',
  '{}'::jsonb,
  '{}'::jsonb,
  1,
  false,
  'global'
)
ON CONFLICT DO NOTHING;

SELECT code, "nameEn", category, "defaultEnabled" FROM agent_definitions WHERE code IN ('p2p_monitor', 'pos_integrity');

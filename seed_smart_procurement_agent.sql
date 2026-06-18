-- Seed smart_procurement agent definition so ApprovalService.create() accepts it
INSERT INTO agent_definitions (
  code, "nameEn", "nameAr", category,
  "descriptionEn", "descriptionAr",
  skills, permissions, restrictions, "outputTypes",
  "defaultEnabled", "minConfidence", "requiresApproval",
  phase, "iconKey", "outputSubjectType", "outputSchema",
  "triggerRules", version, "isCustom", "tenantScope"
)
VALUES (
  'smart_procurement',
  'Smart Procurement Agent',
  'وكيل الشراء الذكي',
  'procurement',
  'Analyzes inventory levels, P2P marketplace listings, and supplier catalog prices to identify the best sourcing opportunity for each item below reorder threshold.',
  'يحلل مستويات المخزون وعروض البورصة الدوائية وأسعار الموردين ليحدد أفضل مصدر شراء لكل منتج وصل أو اقترب من حد إعادة الطلب.',
  '["inventory_analysis","p2p_price_comparison","supplier_catalog_lookup","distance_scoring"]'::jsonb,
  '["read_inventory","read_p2p_listings","read_supplier_catalog","create_p2p_order","create_procurement_draft"]'::jsonb,
  '["no_auto_execute_above_threshold"]'::jsonb,
  '["smart_procurement"]'::jsonb,
  true,
  0.70,
  true,
  1,
  'shopping-cart',
  'smart_procurement',
  '{}'::jsonb,
  '{}'::jsonb,
  1,
  false,
  'global'
)
ON CONFLICT DO NOTHING;

SELECT code, "nameEn", category FROM agent_definitions WHERE code = 'smart_procurement';

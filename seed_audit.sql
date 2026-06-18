-- Seed ai_audit_logs with realistic data for the pharmacy tenant
-- so the AI Center audit tab shows performance data

DO $$
DECLARE
  tenant_id UUID := '8c390877-e99c-41db-b3d2-91dc139c3bcc';
  user_id   UUID := 'e53b3238-da22-431d-aa39-d9a604c214bb';
BEGIN

-- Last 7 days of AI generation runs
INSERT INTO ai_audit_logs (
  "pharmacyTenantId", "triggeredByUserId",
  status, model, "promptVersion",
  "latencyMs", "totalInputTokens", "totalOutputTokens",
  "recommendationsGenerated", "outputsBlocked",
  "createdAt"
)
VALUES
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '2.1.0', 3420, 1850, 620, 5, 0, NOW() - INTERVAL '6 days'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '2.1.0', 2980, 1720, 590, 4, 0, NOW() - INTERVAL '5 days'),
  (tenant_id, user_id, 'failed',  'gpt-4o-mini-2024-07-18', '2.1.0', 850,  420,  0,   0, 0, NOW() - INTERVAL '4 days 14 hours'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '2.1.0', 3150, 1900, 640, 6, 0, NOW() - INTERVAL '4 days'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '1.3.0', 2760, 1540, 480, 3, 0, NOW() - INTERVAL '3 days 6 hours'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '2.1.0', 4120, 2100, 710, 7, 1, NOW() - INTERVAL '3 days'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '2.1.0', 2890, 1680, 560, 5, 0, NOW() - INTERVAL '2 days'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '1.3.0', 3200, 1820, 610, 4, 0, NOW() - INTERVAL '1 day 8 hours'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '2.1.0', 3050, 1760, 580, 5, 0, NOW() - INTERVAL '1 day'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '1.0.0', 2450, 1320, 440, 2, 0, NOW() - INTERVAL '5 hours'),
  (tenant_id, user_id, 'success', 'gpt-4o-mini-2024-07-18', '2.1.0', 3380, 1890, 630, 5, 0, NOW() - INTERVAL '2 hours');

-- Seed token usage for last 7 days
INSERT INTO ai_token_usage ("tenantId", "day", "inputTokens", "outputTokens", "calls", "updatedAt")
VALUES
  (tenant_id, CURRENT_DATE - 6, 1850, 620, 1, NOW()),
  (tenant_id, CURRENT_DATE - 5, 1720, 590, 1, NOW()),
  (tenant_id, CURRENT_DATE - 4, 2320, 640, 2, NOW()),
  (tenant_id, CURRENT_DATE - 3, 3640, 1190, 2, NOW()),
  (tenant_id, CURRENT_DATE - 2, 1680, 560, 1, NOW()),
  (tenant_id, CURRENT_DATE - 1, 3580, 1190, 2, NOW()),
  (tenant_id, CURRENT_DATE,    3210, 1070, 2, NOW())
ON CONFLICT ("tenantId", "day") DO UPDATE
  SET "inputTokens"  = EXCLUDED."inputTokens",
      "outputTokens" = EXCLUDED."outputTokens",
      "calls"        = EXCLUDED."calls",
      "updatedAt"    = NOW();

END $$;

SELECT COUNT(*) AS audit_rows FROM ai_audit_logs WHERE "pharmacyTenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc';
SELECT * FROM ai_token_usage WHERE "tenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc' ORDER BY day DESC;

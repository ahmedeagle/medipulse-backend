-- Check approvals table and recent recommendations
\echo '=== APPROVALS TABLE COLUMNS ==='
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'approvals'
ORDER BY ordinal_position;

\echo ''
\echo '=== RECENT RECOMMENDATIONS ==='
SELECT id, type, "pharmacyTenantId", "productId", "riskLevel", "isDismissed", "createdAt"
FROM ai_recommendations
ORDER BY "createdAt" DESC
LIMIT 10;

\echo ''
\echo '=== RECENT APPROVALS ==='
SELECT * FROM approvals ORDER BY "createdAt" DESC LIMIT 10;

-- Check AI recommendations and approval tasks
\echo '=== AI RECOMMENDATIONS (P2P / EXPIRY related) ==='
SELECT id, type, "tenantId", "productId", "riskLevel", status, "createdAt"
FROM ai_recommendations
WHERE type IN ('P2P_LISTING_SUGGESTION', 'DEAD_STOCK_ALERT', 'REORDER')
ORDER BY "createdAt" DESC
LIMIT 20;

\echo ''
\echo '=== APPROVAL TASKS (risk type) ==='
SELECT id, type, status, title, "tenantId", "deepLink", "createdAt"
FROM approval_tasks
WHERE type = 'risk'
  OR title LIKE '%انتها%'
  OR title LIKE '%p2p%'
  OR title LIKE '%P2P%'
ORDER BY "createdAt" DESC
LIMIT 10;

\echo ''
\echo '=== ALL RECENT APPROVAL TASKS ==='
SELECT id, type, status, title, "tenantId", "createdAt"
FROM approval_tasks
ORDER BY "createdAt" DESC
LIMIT 10;

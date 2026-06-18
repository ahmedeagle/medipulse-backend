-- Check users and their tenantId
\echo '=== USERS AND THEIR TENANTS ==='
SELECT u.id, u.email, u."tenantId", u.role, t.name as tenant_name, t.type as tenant_type
FROM users u
LEFT JOIN tenants t ON t.id = u."tenantId"
ORDER BY u."createdAt" DESC
LIMIT 20;

\echo ''
\echo '=== EXISTING NOTIFICATIONS ==='
SELECT id, "tenantId", type, title, "resourceRef", "isRead", "createdAt"
FROM notifications
ORDER BY "createdAt" DESC
LIMIT 20;

\echo ''
\echo '=== EXPIRY ALERTS API SIMULATION ==='
SELECT inv.id, inv."pharmacyTenantId", inv.quantity, inv."expiryDate",
       (inv."expiryDate"::date - CURRENT_DATE) as days_left
FROM inventory_items inv
WHERE inv."pharmacyTenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc'
  AND inv."expiryDate" IS NOT NULL
  AND inv."expiryDate" >= CURRENT_DATE::text
  AND inv."expiryDate" <= (CURRENT_DATE + INTERVAL '180 days')::text
  AND inv.quantity > 0
  AND inv."deletedAt" IS NULL
ORDER BY inv."expiryDate" ASC;

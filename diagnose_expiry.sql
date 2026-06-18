-- Diagnose expiry alerts
\echo '=== ALL INVENTORY ITEMS WITH EXPIRY DATE ==='
SELECT id, "pharmacyTenantId", quantity, "expiryDate", "deletedAt"
FROM inventory_items
WHERE "expiryDate" IS NOT NULL
ORDER BY "expiryDate" ASC;

\echo ''
\echo '=== ITEMS EXPIRING WITHIN 180 DAYS, QTY > 0, NOT DELETED ==='
SELECT id, "pharmacyTenantId", quantity, "expiryDate"
FROM inventory_items
WHERE "expiryDate" IS NOT NULL
  AND "expiryDate" >= CURRENT_DATE
  AND "expiryDate" <= (CURRENT_DATE + INTERVAL '180 days')
  AND quantity > 0
  AND "deletedAt" IS NULL
ORDER BY "expiryDate" ASC;

\echo ''
\echo '=== ALL TENANTS ==='
SELECT id, name, type FROM tenants ORDER BY "createdAt" DESC LIMIT 10;

\echo ''
\echo '=== PHARMACY ADMIN USER AND THEIR TENANT ==='
SELECT u.id, u.email, u."tenantId", u.role, t.name as tenant_name
FROM users u
LEFT JOIN tenants t ON t.id = u."tenantId"
WHERE u.role = 'PHARMACY_ADMIN'
   OR u.role = 'pharmacy_admin'
LIMIT 10;

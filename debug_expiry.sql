-- Replicate exact ExpiryProtectionService query for the pharmacy tenant
SELECT inv.id, inv."expiryDate", inv.quantity, inv."deletedAt", inv."productId"
FROM inventory_items inv
WHERE inv."pharmacyTenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc'
  AND inv."expiryDate" IS NOT NULL
  AND inv."expiryDate" >= CURRENT_DATE
  AND inv."expiryDate" <= (CURRENT_DATE + INTERVAL '180 days')
  AND inv.quantity > 0
  AND inv."deletedAt" IS NULL
ORDER BY inv."expiryDate" ASC;

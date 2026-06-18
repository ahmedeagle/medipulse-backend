-- Check seller profiles and fix notifications
\echo '=== SELLER PROFILES ==='
SELECT * FROM seller_profiles;

\echo ''
\echo '=== P2P LISTINGS ==='
SELECT id, "sellerTenantId", "inventoryItemId", status, "listingType" FROM p2p_listings LIMIT 10;

\echo ''
\echo '=== NEAR EXPIRY NOTIFICATIONS (bad resourceRef) ==='
SELECT id, type, title, "resourceRef", "isRead", "createdAt"
FROM notifications
WHERE type IN ('near_expiry', 'expiry_digest')
ORDER BY "createdAt" DESC;

\echo ''
\echo '=== ITEM WITH EXPIRY CHECK - cast comparison ==='
SELECT id, "pharmacyTenantId", quantity, "expiryDate",
       ("expiryDate"::date - CURRENT_DATE) as days_left
FROM inventory_items
WHERE "pharmacyTenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc'
  AND "expiryDate" IS NOT NULL
  AND "expiryDate"::date >= CURRENT_DATE
  AND "expiryDate"::date <= (CURRENT_DATE + INTERVAL '180 days')::date
  AND quantity > 0
  AND "deletedAt" IS NULL
ORDER BY "expiryDate" ASC;

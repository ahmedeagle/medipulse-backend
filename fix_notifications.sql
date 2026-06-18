-- Fix near_expiry notifications that have the dedup key as resourceRef instead of a proper URL

\echo '=== BEFORE FIX ==='
SELECT id, type, title, "resourceRef", "isRead" FROM notifications WHERE type = 'near_expiry' ORDER BY "createdAt" DESC;

-- Update notifications that have the dedup key pattern (no leading /)
UPDATE notifications
SET "resourceRef" = CONCAT('/pharmacy/p2p?tab=sell&openAdd=1&itemId=',
  SPLIT_PART(SPLIT_PART("resourceRef", ':', 3), ':', 1))
WHERE type = 'near_expiry'
  AND "resourceRef" NOT LIKE '/%'
  AND "resourceRef" LIKE 'near_expiry:%';

-- Also reset isRead so user sees them again
UPDATE notifications
SET "isRead" = false, "readAt" = NULL
WHERE type IN ('near_expiry', 'expiry_digest')
  AND "createdAt" > NOW() - INTERVAL '1 day';

\echo '=== AFTER FIX ==='
SELECT id, type, title, "resourceRef", "isRead" FROM notifications WHERE type IN ('near_expiry', 'expiry_digest') ORDER BY "createdAt" DESC;

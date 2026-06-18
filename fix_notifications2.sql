-- Fix the near_expiry notifications with wrong resourceRef (UUID extraction was wrong)
-- resourceRef format: near_expiry:{uuid}:{window}
-- SPLIT_PART by ':' → part 2 is the UUID

\echo '=== FIXING NEAR_EXPIRY NOTIFICATIONS ==='

UPDATE notifications
SET "resourceRef" = CONCAT('/pharmacy/p2p?tab=sell&openAdd=1&itemId=',
  SPLIT_PART("resourceRef", ':', 2))
WHERE type = 'near_expiry'
  AND "resourceRef" LIKE '/pharmacy/p2p?tab=sell&openAdd=1&itemId=1'
   OR "resourceRef" LIKE '/pharmacy/p2p?tab=sell&openAdd=1&itemId=6';

-- Actually let's just do it directly with the known IDs
UPDATE notifications
SET "resourceRef" = '/pharmacy/p2p?tab=sell&openAdd=1&itemId=5964942a-4e46-4d3f-ab02-4197d975ec39'
WHERE id = 'f3a7dce3-b952-4759-98fd-ec6ce0a0c5bd';

UPDATE notifications
SET "resourceRef" = '/pharmacy/p2p?tab=sell&openAdd=1&itemId=cb74a262-2b41-4d7b-91e8-c8567b67244e'
WHERE id = '1e8994a0-14d5-4580-b008-053b706ea43b';

\echo '=== RESULT ==='
SELECT id, type, title, "resourceRef", "isRead" FROM notifications WHERE type IN ('near_expiry', 'expiry_digest') ORDER BY "createdAt" DESC;

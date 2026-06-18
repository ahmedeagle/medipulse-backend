-- Clean up duplicate approvals: keep the newest per (tenantId, subjectType, subjectId)
-- and expire all older duplicates.
BEGIN;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "tenantId", "subjectType", "subjectId"
           ORDER BY "createdAt" DESC
         ) AS rn
  FROM approvals
  WHERE "subjectType" = 'recommendation'
)
UPDATE approvals
SET status = 'expired'
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
)
AND status IN ('pending', 'modified');

-- Also expire any pending approvals whose rec is now dismissed
UPDATE approvals a
SET status = 'expired'
WHERE a."subjectType" = 'recommendation'
  AND a.status IN ('pending', 'modified')
  AND NOT EXISTS (
    SELECT 1 FROM ai_recommendations r
    WHERE r.id = a."subjectId"
      AND r."isDismissed" = false
  );

COMMIT;

-- Show what remains
SELECT status, COUNT(*) as count
FROM approvals
WHERE "subjectType" = 'recommendation'
GROUP BY status
ORDER BY status;

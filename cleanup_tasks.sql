-- Delete approval tasks and recommendations for items expiring > 90 days from now
-- Items to remove: 173d (c7029a06), 277d (3cb7a719), 435d (6038b27a)

DELETE FROM approvals
WHERE "tenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc'
  AND "subjectType" = 'recommendation'
  AND "subjectId" IN (
    SELECT id FROM ai_recommendations
    WHERE "pharmacyTenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc'
      AND type = 'P2P_LISTING_SUGGESTION'
      AND (payload->>'daysLeft')::int > 90
  );

DELETE FROM ai_recommendations
WHERE "pharmacyTenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc'
  AND type = 'P2P_LISTING_SUGGESTION'
  AND (payload->>'daysLeft')::int > 90;

-- Confirm what remains
SELECT a.id, a.title, a.priority FROM approvals a
WHERE a."tenantId" = '8c390877-e99c-41db-b3d2-91dc139c3bcc'
  AND a."subjectType" = 'recommendation' AND a.status = 'pending'
ORDER BY a."createdAt" DESC;

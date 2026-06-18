-- Check current enum values
\echo '=== CURRENT ai_recommendations_type_enum VALUES ==='
SELECT unnest(enum_range(NULL::ai_recommendations_type_enum))::text AS value;

\echo ''
\echo '=== CURRENT notification type enum VALUES ==='
SELECT unnest(enum_range(NULL::notifications_type_enum))::text AS value;

-- Add missing enum values
ALTER TYPE ai_recommendations_type_enum ADD VALUE IF NOT EXISTS 'P2P_LISTING_SUGGESTION';
ALTER TYPE ai_recommendations_type_enum ADD VALUE IF NOT EXISTS 'INTER_BRANCH_TRADE';

\echo ''
\echo '=== UPDATED ai_recommendations_type_enum VALUES ==='
SELECT unnest(enum_range(NULL::ai_recommendations_type_enum))::text AS value;

-- Check actual table names and columns
\echo '=== TABLES RELATED TO AI ==='
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name LIKE '%ai%' OR table_name LIKE '%recommendation%' OR table_name LIKE '%approval%' OR table_name LIKE '%task%')
ORDER BY table_name;

\echo ''
\echo '=== AI_RECOMMENDATIONS COLUMNS ==='
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'ai_recommendations'
ORDER BY ordinal_position;

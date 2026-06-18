SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'ai_recommendations' AND column_name = 'type';

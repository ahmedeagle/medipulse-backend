ALTER TYPE ai_recommendations_type_enum ADD VALUE IF NOT EXISTS 'expired_quarantine';
SELECT unnest(enum_range(NULL::ai_recommendations_type_enum))::text AS value ORDER BY 1;

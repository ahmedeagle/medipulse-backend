BEGIN;

ALTER TYPE ai_recommendations_type_enum RENAME VALUE 'P2P_LISTING_SUGGESTION' TO 'p2p_listing_suggestion';
ALTER TYPE ai_recommendations_type_enum RENAME VALUE 'INTER_BRANCH_TRADE' TO 'inter_branch_trade';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'smart_procurement'
      AND enumtypid = 'ai_recommendations_type_enum'::regtype
  ) THEN
    ALTER TYPE ai_recommendations_type_enum ADD VALUE 'smart_procurement';
  END IF;
END $$;

COMMIT;

SELECT unnest(enum_range(NULL::ai_recommendations_type_enum)) AS val;

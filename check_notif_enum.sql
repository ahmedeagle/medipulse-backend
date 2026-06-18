SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'notifications' AND column_name = 'type';

SELECT unnest(enum_range(NULL::notifications_type_enum)) AS val
WHERE EXISTS (
  SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum'
);

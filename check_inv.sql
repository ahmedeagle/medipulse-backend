SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'inventory_items'
ORDER BY ordinal_position;

SELECT id, "expiryDate", quantity, "pharmacyTenantId"
FROM inventory_items
WHERE "expiryDate" IS NOT NULL
LIMIT 5;

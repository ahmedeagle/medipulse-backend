// Run with: node debug_expiry.js
const { Client } = require('pg');

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'medipulse',
  user: 'postgres',
  password: 'postgres',
});

const TENANT_ID = '8c390877-e99c-41db-b3d2-91dc139c3bcc';

async function main() {
  await client.connect();
  console.log('Connected to DB\n');

  const now = new Date();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 180);
  const todayDate = now.toISOString().slice(0, 10);

  console.log('Parameters:');
  console.log('  tenantId:', TENANT_ID);
  console.log('  today:', todayDate);
  console.log('  horizon:', horizon.toISOString());
  console.log('  horizon as date string:', horizon.toISOString().slice(0, 10));
  console.log('');

  // Exact same query as TypeORM generates (parameters sent as their JS types)
  // TypeORM would send today as a string and horizon as a Date (timestamptz)
  const result = await client.query(
    `SELECT inv.id, inv."pharmacyTenantId", inv.quantity, inv."expiryDate", inv."deletedAt"
     FROM inventory_items inv
     WHERE inv."pharmacyTenantId" = $1
       AND inv."expiryDate" IS NOT NULL
       AND inv."expiryDate" >= $2
       AND inv."expiryDate" <= $3
       AND inv.quantity > 0
       AND inv."deletedAt" IS NULL
     ORDER BY inv."expiryDate" ASC
     LIMIT 100`,
    [TENANT_ID, todayDate, horizon]   // today as string, horizon as Date object
  );

  console.log('RESULT (today=string, horizon=Date):', result.rows.length, 'rows');
  console.log(result.rows);
  console.log('');

  // Try with horizon as string
  const result2 = await client.query(
    `SELECT inv.id, inv."pharmacyTenantId", inv.quantity, inv."expiryDate"
     FROM inventory_items inv
     WHERE inv."pharmacyTenantId" = $1
       AND inv."expiryDate" IS NOT NULL
       AND inv."expiryDate" >= $2::date
       AND inv."expiryDate" <= $3::date
       AND inv.quantity > 0
       AND inv."deletedAt" IS NULL
     ORDER BY inv."expiryDate" ASC`,
    [TENANT_ID, todayDate, horizon.toISOString().slice(0, 10)]
  );

  console.log('RESULT (both as date strings):', result2.rows.length, 'rows');
  console.log(result2.rows);

  await client.end();
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });

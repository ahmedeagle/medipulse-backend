const {Client} = require('pg');
(async () => {
  const c = new Client({connectionString:'postgresql://postgres:postgres@localhost:5432/medipulse'});
  await c.connect();
  for (const t of ['procurement_drafts','inventory_items','ai_recommendations','tenants','supplier_listings','products']) {
    const r = await c.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position`, [t]);
    console.log('---', t);
    console.log(r.rows.map(x => `  ${x.column_name}: ${x.data_type}${x.is_nullable==='NO'?' NN':''}`).join('\n'));
  }
  await c.end();
})();

const {Client} = require('pg');
(async () => {
  const c = new Client({connectionString:'postgresql://postgres:postgres@localhost:5432/medipulse'});
  await c.connect();
  const r = await c.query(`
    SELECT tablename, indexname, indexdef
      FROM pg_indexes
     WHERE tablename IN ('approvals','approval_events','inventory_items','procurement_drafts','ai_recommendations','products')
     ORDER BY tablename, indexname`);
  for (const x of r.rows) console.log(x.tablename.padEnd(22), x.indexname);
  await c.end();
})();

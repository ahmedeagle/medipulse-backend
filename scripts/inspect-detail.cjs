const {Client} = require('pg');
(async () => {
  const c = new Client({connectionString:'postgresql://postgres:postgres@localhost:5432/medipulse'});
  await c.connect();
  console.log('drafts:', (await c.query(`SELECT id, status, "pharmacyTenantId" FROM procurement_drafts`)).rows);
  console.log('recs:',   (await c.query(`SELECT id, type, "riskLevel", "isDismissed" FROM ai_recommendations`)).rows);
  console.log('items suggested:', (await c.query(`SELECT id, "linkStatus", "matchScore" FROM inventory_items WHERE "linkStatus"='suggested' AND "deletedAt" IS NULL`)).rows);
  await c.end();
})();

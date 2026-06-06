const {Client} = require('pg');
(async () => {
  const c = new Client({connectionString:'postgresql://postgres:postgres@localhost:5432/medipulse'});
  await c.connect();
  const r = await c.query(`UPDATE ai_recommendations SET "isDismissed"=false WHERE "isDismissed"=true RETURNING id`);
  console.log('re-armed recs:', r.rowCount);
  await c.end();
})();

const {Client} = require('pg');
(async () => {
  const c = new Client({connectionString:'postgresql://postgres:postgres@localhost:5432/medipulse'});
  await c.connect();
  console.log((await c.query(`SELECT code, "minConfidence", "defaultEnabled" FROM agent_definitions`)).rows);
  console.log('--- approvals ---');
  console.log((await c.query(`SELECT id, "agentCode", status, confidence, title FROM approvals ORDER BY "createdAt" DESC LIMIT 10`)).rows);
  await c.end();
})();

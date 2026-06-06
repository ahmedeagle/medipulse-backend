const {Client} = require('pg');
(async () => {
  const c = new Client({connectionString: 'postgresql://postgres:postgres@localhost:5432/medipulse'});
  await c.connect();
  const q = async (label, sql) => { try { const r = await c.query(sql); console.log(label, r.rows); } catch (e) { console.log(label, 'ERR', e.message); } };
  await q('users',         `SELECT id, email, role, "tenantId" FROM users LIMIT 10`);
  await q('tenants',       `SELECT id, name, kind FROM tenants LIMIT 10`);
  await q('products',      `SELECT count(*) FROM products`);
  await q('inv_items',     `SELECT count(*) FROM inventory_items WHERE "deletedAt" IS NULL`);
  await q('inv_by_status', `SELECT "linkStatus", count(*) FROM inventory_items WHERE "deletedAt" IS NULL GROUP BY "linkStatus"`);
  await q('ai_recs',       `SELECT count(*) FROM ai_recommendations`);
  await q('ai_recs_type',  `SELECT type, count(*) FROM ai_recommendations GROUP BY type`);
  await q('drafts',        `SELECT status, count(*) FROM procurement_drafts GROUP BY status`);
  await q('approvals',     `SELECT status, "agentCode", count(*) FROM approvals GROUP BY status, "agentCode"`);
  await q('agents',        `SELECT code, "defaultEnabled" FROM agent_definitions`);
  await c.end();
})();

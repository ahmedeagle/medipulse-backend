// Directly triggers AI rules engine + expiry notifications for the pharmacy tenant
// bypasses HTTP auth by calling services directly via DB
const { Client } = require('pg');

const TENANT_ID = '8c390877-e99c-41db-b3d2-91dc139c3bcc';

const client = new Client({
  host: 'localhost', port: 5432,
  database: 'medipulse', user: 'postgres', password: 'postgres',
});

async function main() {
  await client.connect();
  console.log('Connected\n');

  // Step 1: Check current state
  console.log('=== EXPIRY ITEMS ===');
  const items = await client.query(
    `SELECT id, quantity, "expiryDate", (CURRENT_DATE - "expiryDate"::date) * -1 as days_left
     FROM inventory_items
     WHERE "pharmacyTenantId" = $1 AND "expiryDate" IS NOT NULL
       AND quantity > 0 AND "deletedAt" IS NULL
       AND "expiryDate" <= CURRENT_DATE + INTERVAL '90 days'
     ORDER BY "expiryDate" ASC`, [TENANT_ID]
  );
  console.table(items.rows);

  // Step 2: Check existing AI recommendations for P2P
  console.log('\n=== EXISTING P2P RECOMMENDATIONS ===');
  const recs = await client.query(
    `SELECT id, type, "riskLevel", "isDismissed", "createdAt", payload->>'daysLeft' as days_left
     FROM ai_recommendations
     WHERE "pharmacyTenantId" = $1 AND type = 'P2P_LISTING_SUGGESTION'
     ORDER BY "createdAt" DESC LIMIT 10`, [TENANT_ID]
  );
  console.table(recs.rows);

  // Step 3: Check existing approvals (tasks)
  console.log('\n=== EXISTING RISK APPROVALS (tasks) ===');
  const tasks = await client.query(
    `SELECT id, status, title, "createdAt", "expiresAt"
     FROM approvals
     WHERE "tenantId" = $1 AND "subjectType" = 'recommendation'
     ORDER BY "createdAt" DESC LIMIT 10`, [TENANT_ID]
  );
  console.table(tasks.rows);

  // Step 4: Check notifications
  console.log('\n=== NOTIFICATIONS ===');
  const notifs = await client.query(
    `SELECT id, type, title, "resourceRef", "isRead", "createdAt"
     FROM notifications
     WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT 10`, [TENANT_ID]
  );
  console.table(notifs.rows);

  // Step 5: Insert P2P recommendations directly for each expiring item
  console.log('\n=== INSERTING P2P RECOMMENDATIONS ===');
  for (const item of items.rows) {
    const daysLeft = parseInt(item.days_left);
    const riskLevel = daysLeft <= 60 ? 'HIGH' : 'MEDIUM';
    const discountPct = daysLeft <= 30 ? 20 : daysLeft <= 60 ? 15 : 10;

    // Check if recommendation already exists and not dismissed
    const existing = await client.query(
      `SELECT id FROM ai_recommendations
       WHERE "pharmacyTenantId" = $1 AND type = 'P2P_LISTING_SUGGESTION'
         AND payload->>'inventoryItemId' = $2 AND "isDismissed" = false`,
      [TENANT_ID, item.id]
    );

    if (existing.rows.length > 0) {
      console.log(`  Item ${item.id.slice(0,8)}: recommendation already exists (${existing.rows[0].id.slice(0,8)})`);
      continue;
    }

    // Get product info
    const prod = await client.query(
      `SELECT p.id, p.name, p."nameAr" FROM products p
       JOIN inventory_items i ON i."productId" = p.id WHERE i.id = $1`, [item.id]
    );
    const productId = prod.rows[0]?.id;
    const productName = prod.rows[0]?.name || 'Unknown';
    const productNameAr = prod.rows[0]?.nameAr || productName;

    const payload = {
      inventoryItemId: item.id,
      productId,
      productName,
      productNameAr,
      quantity: item.quantity,
      expiryDate: item.expiryDate,
      daysLeft,
      suggestedListingType: 'clearance',
      suggestedDiscountPct: discountPct,
      action: 'list_on_p2p',
      deepLink: `/pharmacy/p2p?tab=sell&openAdd=1&itemId=${item.id}`,
    };

    const rec = await client.query(
      `INSERT INTO ai_recommendations ("pharmacyTenantId", type, "productId", "riskLevel", confidence, "confidenceLabel", payload, explanation, "rulesTriggered", "isDismissed")
       VALUES ($1, 'P2P_LISTING_SUGGESTION', $2, $3, 0.92, 'high', $4, $5, $6, false)
       RETURNING id`,
      [
        TENANT_ID, productId, riskLevel, JSON.stringify(payload),
        `${productNameAr} تنتهي خلال ${daysLeft} يوم — يُنصح بإدراجه في سوق التبادل الصيدلاني`,
        JSON.stringify(['NEAR_EXPIRY_WITHIN_90_DAYS']),
      ]
    );
    const recId = rec.rows[0].id;
    console.log(`  Inserted rec ${recId.slice(0,8)} for item ${item.id.slice(0,8)} (${daysLeft}d, ${riskLevel})`);

    // Step 6: Insert approval task for this recommendation
    const title = `انتهاء قريب: ${productNameAr} — ${daysLeft} يوم`;
    const summary = `الكمية: ${item.quantity} وحدة · تنتهي خلال ${daysLeft} يوم · خصم مقترح ${discountPct}% · الإجراء: إدراج في البيع للصيدليات`;
    const expiresAt = new Date(Date.now() + daysLeft * 86400000).toISOString();

    await client.query(
      `INSERT INTO approvals ("tenantId", "agentCode", "subjectType", "subjectId", title, summary, rationale, confidence, "confidenceLabel", priority, status, payload, "createdByAgent", "expiresAt")
       VALUES ($1, 'inventory_expert', 'recommendation', $2, $3, $4, $5, 0.85, 'high', $6, 'pending', $7, 'inventory_expert', $8)`,
      [
        TENANT_ID, recId, title, summary,
        `المنتج يقترب من تاريخ الانتهاء. البيع الآن بخصم ${discountPct}% أفضل من الخسارة الكاملة.`,
        riskLevel === 'HIGH' ? 'critical' : 'high',
        JSON.stringify({ ...payload, deepLink: payload.deepLink, recType: 'P2P_LISTING_SUGGESTION' }),
        expiresAt,
      ]
    );
    console.log(`  Inserted approval task for "${title}"`);
  }

  // Step 7: Final state
  console.log('\n=== FINAL STATE ===');
  const finalTasks = await client.query(
    `SELECT id, status, title, priority FROM approvals
     WHERE "tenantId" = $1 AND "subjectType" = 'recommendation' AND status = 'pending'
     ORDER BY "createdAt" DESC`, [TENANT_ID]
  );
  console.log(`Pending risk tasks: ${finalTasks.rows.length}`);
  console.table(finalTasks.rows);

  await client.end();
  console.log('\nDone. Refresh the AI Center tasks tab now.');
}

main().catch(err => { console.error('FATAL:', err.message, err.stack); process.exit(1); });

/**
 * Dev-only fixture seeder for the AI Center demo.
 *
 * Creates:
 *  • 1 procurement_draft with status='pending_review'   (purchase_expert)
 *  • 1 inventory_item flipped to linkStatus='suggested' (catalog_expert)
 *  • 1 ai_recommendation REORDER + matching approval    (inventory_expert)
 *
 * Idempotent: re-running it does nothing if fixtures already exist.
 *
 * Usage:  node scripts/seed-ai-fixtures.cjs
 */
const { Client } = require('pg');

const PHARMACY_TENANT = '8c390877-e99c-41db-b3d2-91dc139c3bcc'; // ahmed.emam pharmacy

(async () => {
  const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/medipulse' });
  await c.connect();

  // ── pick or create a supplier tenant ──────────────────────────────────
  let supplier = (await c.query(
    `SELECT id, name FROM tenants WHERE type::text='supplier' AND "isActive"=true LIMIT 1`
  )).rows[0];
  if (!supplier) {
    console.log('No supplier tenant — using any non-pharmacy tenant');
    supplier = (await c.query(
      `SELECT id, name FROM tenants WHERE id<>$1 LIMIT 1`, [PHARMACY_TENANT]
    )).rows[0];
  }
  if (!supplier) throw new Error('No second tenant found in DB; seed a supplier first');

  const product = (await c.query(`SELECT id, name, "nameAr" FROM products LIMIT 1`)).rows[0];
  if (!product) throw new Error('No products in DB');

  // ── 1) procurement draft ──────────────────────────────────────────────
  const existingDraft = (await c.query(
    `SELECT id FROM procurement_drafts
      WHERE "pharmacyTenantId"=$1 AND status='pending_review' LIMIT 1`,
    [PHARMACY_TENANT]
  )).rows[0];

  if (!existingDraft) {
    const draft = (await c.query(
      `INSERT INTO procurement_drafts
        ("pharmacyTenantId","supplierTenantId","productId",
         "suggestedQuantity","unitPrice",currency,"urgencyLevel",status,"expiresAt")
       VALUES ($1,$2,$3,50,12.50,'SAR','high','pending_review', NOW() + INTERVAL '48 hours')
       RETURNING id`,
      [PHARMACY_TENANT, supplier.id, product.id]
    )).rows[0];
    console.log(`✓ procurement_draft created: ${draft.id}`);
  } else {
    console.log(`• procurement_draft already exists: ${existingDraft.id}`);
  }

  // ── 2) inventory_item flipped to 'suggested' ──────────────────────────
  const itemRow = (await c.query(
    `SELECT id FROM inventory_items
      WHERE "pharmacyTenantId"=$1 AND "linkStatus"='unlinked' AND "deletedAt" IS NULL
      LIMIT 1`,
    [PHARMACY_TENANT]
  )).rows[0];

  if (itemRow) {
    const altProduct = (await c.query(
      `SELECT id, name, "nameAr" FROM products WHERE id<>$1 LIMIT 1`, [product.id]
    )).rows[0];
    await c.query(
      `UPDATE inventory_items
          SET "linkStatus"='suggested',
              "matchScore"=92,
              "matchExplanation"=$1
        WHERE id=$2`,
      [
        JSON.stringify({
          suggestedProductId: altProduct.id,
          suggestedProductName: altProduct.nameAr || altProduct.name,
          signals: ['barcode_exact', 'name_strong'],
        }),
        itemRow.id,
      ]
    );
    console.log(`✓ inventory_item flipped to 'suggested': ${itemRow.id}`);
  } else {
    console.log('• no unlinked inventory_item available — skipping catalog fixture');
  }

  // ── 3) AI recommendation (REORDER) ────────────────────────────────────
  const existingRec = (await c.query(
    `SELECT id FROM ai_recommendations
      WHERE "pharmacyTenantId"=$1 AND type='reorder' AND "isDismissed"=false LIMIT 1`,
    [PHARMACY_TENANT]
  )).rows[0];

  if (!existingRec) {
    const rec = (await c.query(
      `INSERT INTO ai_recommendations
        ("pharmacyTenantId","type","productId","payload","explanation",
         "explanationFromGpt","riskLevel","confidence","confidenceLabel",
         "rulesTriggered","isDismissed")
       VALUES ($1,'reorder',$2,$3,$4,false,'HIGH',0.85,'high',$5,false)
       RETURNING id`,
      [
        PHARMACY_TENANT,
        product.id,
        JSON.stringify({
          currentQuantity: 8,
          dailySalesRate: 4.2,
          stockDays: 1.9,
          suggestedReorderQty: 60,
        }),
        'المخزون منخفض ومتوسط البيع 4.2 وحدة/يوم؛ يكفي لأقل من يومين.',
        JSON.stringify(['low_stock', 'high_velocity']),
      ]
    )).rows[0];
    console.log(`✓ ai_recommendation created: ${rec.id}`);
    console.log('  → restart the backend (or wait ≤30s) for AgentBridgeService to emit the approval.');
    console.log('  → for an immediate effect, call POST /api/v1/ai-center/dev/sync-fixtures.');
  } else {
    console.log(`• ai_recommendation already exists: ${existingRec.id}`);
  }

  // ── summary ───────────────────────────────────────────────────────────
  const summary = (await c.query(
    `SELECT 'drafts'   AS kind, count(*)::int FROM procurement_drafts WHERE "pharmacyTenantId"=$1 AND status='pending_review'
     UNION ALL
     SELECT 'suggested', count(*)::int FROM inventory_items   WHERE "pharmacyTenantId"=$1 AND "linkStatus"='suggested' AND "deletedAt" IS NULL
     UNION ALL
     SELECT 'recs',      count(*)::int FROM ai_recommendations WHERE "pharmacyTenantId"=$1 AND "isDismissed"=false
     UNION ALL
     SELECT 'approvals', count(*)::int FROM approvals          WHERE "tenantId"=$1`, [PHARMACY_TENANT]
  )).rows;
  console.log('\n— Fixture state for pharmacy tenant —');
  for (const r of summary) console.log(`  ${r.kind.padEnd(10)} ${r.count}`);

  await c.end();
})();

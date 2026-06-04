"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const dotenv_1 = require("dotenv");
const path_1 = require("path");
const who_essential_medicines_1 = require("./data/who-essential-medicines");
(0, dotenv_1.config)({ path: (0, path_1.resolve)(process.cwd(), '.env') });
const ds = new typeorm_1.DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: ['src/**/*.entity.ts'],
    synchronize: false,
    logging: false,
});
function normalize(str) {
    return str.toLowerCase().trim().replace(/\s+/g, ' ');
}
async function run() {
    await ds.initialize();
    console.log('✅ Connected to database');
    const repo = ds.getRepository('products');
    let created = 0;
    let skipped = 0;
    for (const drug of who_essential_medicines_1.WHO_ESSENTIAL_MEDICINES) {
        const canonicalName = normalize(drug.genericName || drug.name);
        const existing = await ds.query(`SELECT id FROM products WHERE "canonicalName" = $1 AND COALESCE(strength,'') = $2 AND COALESCE("dosageForm",'') = $3 LIMIT 1`, [canonicalName, drug.strength || '', drug.dosageForm || '']);
        if (existing.length > 0) {
            skipped++;
            continue;
        }
        await ds.query(`INSERT INTO products (
        id, name, "genericName", category, unit,
        barcode, description,
        "canonicalName", "activeIngredient", strength, "dosageForm", "atcCode", manufacturer,
        "isCanonical", "requiresMapping",
        "createdAt"
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4,
        NULL, NULL,
        $5, $6, $7, $8, $9, $10,
        true, false,
        NOW()
      )`, [
            drug.name,
            drug.genericName || null,
            drug.category,
            drug.unit,
            canonicalName,
            drug.genericName || null,
            drug.strength || null,
            drug.dosageForm || null,
            drug.atcCode || null,
            drug.manufacturer || null,
        ]);
        created++;
        if (created % 50 === 0) {
            console.log(`  → ${created} products seeded...`);
        }
    }
    console.log(`\n✅ Seed complete!`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped (already exist): ${skipped}`);
    console.log(`   Total in WHO list: ${who_essential_medicines_1.WHO_ESSENTIAL_MEDICINES.length}`);
    await ds.destroy();
}
run().catch((err) => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
//# sourceMappingURL=seed-products.js.map
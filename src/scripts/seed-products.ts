/**
 * MediPulse Product Seed Script
 *
 * Seeds the master product catalog with WHO Essential Medicines.
 * Run once after initial deployment — idempotent (safe to run multiple times).
 *
 * Usage:
 *   npx ts-node src/scripts/seed-products.ts
 *
 * Requirements:
 *   - .env file with DATABASE_URL set
 *   - PostgreSQL database already created
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';
import { WHO_ESSENTIAL_MEDICINES, SeedProduct } from './data/who-essential-medicines';

config({ path: resolve(process.cwd(), '.env') });

const ds = new DataSource({
  type:        'postgres',
  url:         process.env.DATABASE_URL,
  entities:    ['src/**/*.entity.ts'],
  synchronize: false,
  logging:     false,
});

function normalize(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function run() {
  await ds.initialize();
  console.log('✅ Connected to database');

  const repo = ds.getRepository('products');
  let created = 0;
  let skipped = 0;

  for (const drug of WHO_ESSENTIAL_MEDICINES) {
    // Idempotent: skip if already exists (match on normalized canonical name + strength + form)
    const canonicalName = normalize(drug.genericName || drug.name);
    const existing = await ds.query(
      `SELECT id FROM products WHERE "canonicalName" = $1 AND COALESCE(strength,'') = $2 AND COALESCE("dosageForm",'') = $3 LIMIT 1`,
      [canonicalName, drug.strength || '', drug.dosageForm || ''],
    );

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await ds.query(
      `INSERT INTO products (
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
      )`,
      [
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
      ],
    );

    created++;

    if (created % 50 === 0) {
      console.log(`  → ${created} products seeded...`);
    }
  }

  console.log(`\n✅ Seed complete!`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped (already exist): ${skipped}`);
  console.log(`   Total in WHO list: ${WHO_ESSENTIAL_MEDICINES.length}`);

  await ds.destroy();
}

run().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});

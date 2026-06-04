/**
 * ONE-TIME LOCAL SETUP SCRIPT
 *
 * Runs ONLY for first-time local setup on a fresh database.
 * Creates all tables from current entities using synchronize:true.
 * After running this once, use proper migrations for all future changes.
 *
 * Usage (run once, then delete or never run again):
 *   npx ts-node src/setup-local-db.ts
 *
 * DO NOT run this on production. EVER.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

async function setupLocalDb() {
  console.log('Setting up local database (synchronize:true — local only)...');

  const mainDb = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: ['src/**/*.entity.ts'],
    synchronize: true,
    logging: true,
  });

  const auditDb = new DataSource({
    type: 'postgres',
    url: process.env.AUDIT_DATABASE_URL,
    entities: [
      'src/audit/entities/*.entity.ts',
      'src/analytics/entities/*.entity.ts',
    ],
    synchronize: true,
    logging: true,
  });

  await mainDb.initialize();
  console.log('✅ Main DB tables created');
  await mainDb.destroy();

  await auditDb.initialize();
  console.log('✅ Audit DB tables created');
  await auditDb.destroy();

  console.log('\n✅ Local database setup complete.');
  console.log('You can now run: npm run start:dev');
  process.exit(0);
}

setupLocalDb().catch((err) => {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
});

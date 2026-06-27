import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

/**
 * Standalone DataSource for the AUDIT database TypeORM CLI.
 * Used by: npm run migration:run:audit | migration:generate:audit
 */
export default new DataSource({
  type:     'postgres',
  url:      process.env.AUDIT_DATABASE_URL,

  entities: [
    'src/audit/entities/*.entity.ts',
    'src/analytics/entities/*.entity.ts',
  ],
  migrations: ['src/migrations/audit/*.ts'],

  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging:     false,
});

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (works regardless of where ts-node runs from on Windows)
config({ path: resolve(process.cwd(), '.env') });

/**
 * Standalone DataSource for TypeORM CLI.
 * Used by: npm run migration:run | migration:generate | migration:revert
 *
 * typeorm-ts-node-commonjs is the Windows-compatible TypeORM CLI wrapper.
 * It handles ts-node setup internally without needing the bash shell script.
 */
export const AppDataSource = new DataSource({
  type:     'postgres',
  url:      process.env.DATABASE_URL,

  // Glob patterns — finds all entity files in src/
  entities:   ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],

  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging:     false,
});

export default AppDataSource;

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

export default new DataSource({
  type:     'postgres',
  url:      process.env.DATABASE_URL,
  entities:   ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  migrationsTableName:      'typeorm_migrations',
  // 'each' wraps every migration in its own transaction and allows individual
  // migrations to opt out (transaction = false) — required for CONCURRENTLY indexes.
  migrationsTransactionMode: 'each',
  synchronize: false,
  logging:     false,
});

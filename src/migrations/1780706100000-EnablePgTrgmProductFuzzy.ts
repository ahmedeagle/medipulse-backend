import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enables the pg_trgm extension and adds trigram GIN indexes on the product
 * name columns. This powers the chatbot's typo-tolerant product lookup
 * (similarity() fuzzy fallback) used by:
 *   - ChatService.toolSearchInventory
 *   - ChatService.toolGetReorderRecommendation
 *
 * Without the extension similarity() is unavailable and the fuzzy fallback
 * silently fails. The GIN indexes keep similarity scans fast on large catalogs.
 */
export class EnablePgTrgmProductFuzzy1780706100000 implements MigrationInterface {
  name = 'EnablePgTrgmProductFuzzy1780706100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_products_name_trgm"
        ON "products" USING gin ("name" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_products_name_ar_trgm"
        ON "products" USING gin ("nameAr" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_name_ar_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_name_trgm"`);
  }
}

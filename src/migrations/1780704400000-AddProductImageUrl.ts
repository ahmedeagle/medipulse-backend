import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductImageUrl1780704400000 implements MigrationInterface {
  name = 'AddProductImageUrl1780704400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS "imageUrl" VARCHAR(512)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS "imageUrl"`);
  }
}

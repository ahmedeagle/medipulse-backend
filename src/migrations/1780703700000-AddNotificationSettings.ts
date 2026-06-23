import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationSettings1780703700000 implements MigrationInterface {
  name = 'AddNotificationSettings1780703700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pharmacy_settings
        ADD COLUMN IF NOT EXISTS "notificationSettings" jsonb NOT NULL DEFAULT '{}'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pharmacy_settings DROP COLUMN IF EXISTS "notificationSettings"
    `);
  }
}

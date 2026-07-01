import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the notification decision model (PRD §6.2): severity + intended channels.
 *
 * Additive & backward-compatible — both columns are nullable, so every existing
 * producer keeps working untouched while NotificationService.create() now fills
 * severity/channels centrally from the type policy. No backfill needed: historical
 * rows simply carry NULL (treated as unclassified by readers).
 */
export class AddNotificationSeverityChannels1791000000000 implements MigrationInterface {
  name = 'AddNotificationSeverityChannels1791000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "severity" varchar(12) NULL`);
    await q.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "channels" jsonb NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "notifications" DROP COLUMN IF EXISTS "channels"`);
    await q.query(`ALTER TABLE "notifications" DROP COLUMN IF EXISTS "severity"`);
  }
}

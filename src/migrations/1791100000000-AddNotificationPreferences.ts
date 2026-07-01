import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * notification_preferences — per-pharmacy / per-user delivery control (Preference
 * Filter stage). Risky channels (WhatsApp, push) default to OFF so nothing is ever
 * blasted without explicit opt-in.
 */
export class AddNotificationPreferences1791100000000 implements MigrationInterface {
  name = 'AddNotificationPreferences1791100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "id"                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "pharmacyTenantId"   uuid         NOT NULL,
        "userId"             uuid         NULL,
        "inApp"              boolean      NOT NULL DEFAULT true,
        "email"              boolean      NOT NULL DEFAULT true,
        "whatsapp"           boolean      NOT NULL DEFAULT false,
        "push"               boolean      NOT NULL DEFAULT false,
        "allowLow"           boolean      NOT NULL DEFAULT true,
        "allowMedium"        boolean      NOT NULL DEFAULT true,
        "allowHigh"          boolean      NOT NULL DEFAULT true,
        "allowCritical"      boolean      NOT NULL DEFAULT true,
        "quietHoursStart"    smallint     NULL,
        "quietHoursEnd"      smallint     NULL,
        "quietHoursTimezone" varchar(40)  NOT NULL DEFAULT 'Africa/Cairo',
        "createdAt"          timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"          timestamptz  NOT NULL DEFAULT now()
      )
    `);
    // One row per (tenant, user); NULL userId = tenant-wide default. NULLs are
    // distinct in a plain unique index, so use a partial unique index for the
    // tenant-default row and a normal one for user rows.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notif_pref_tenant_user"
        ON "notification_preferences" ("pharmacyTenantId", "userId")
        WHERE "userId" IS NOT NULL
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notif_pref_tenant_default"
        ON "notification_preferences" ("pharmacyTenantId")
        WHERE "userId" IS NULL
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_notif_pref_tenant"
        ON "notification_preferences" ("pharmacyTenantId")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "notification_preferences"`);
  }
}

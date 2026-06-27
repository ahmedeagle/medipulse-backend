import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backing table for the WhatsApp channel scaffold.
 *
 * The unique index on `providerMessageId` is the cornerstone of webhook
 * idempotency: Meta / 360dialog will retry deliveries on any 5xx, and we
 * MUST collapse retries into a single inbound-handled outcome. Without it,
 * the same "approve" reply could transition an approval twice.
 */
export class AddWhatsappChannel1780705200000 implements MigrationInterface {
  name = 'AddWhatsappChannel1780705200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
        "id"                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId"           uuid         NOT NULL,
        "direction"          varchar(10)  NOT NULL,
        "providerMessageId"  varchar(128) NOT NULL,
        "phone"              varchar(32)  NOT NULL,
        "templateOrPreview"  varchar(200),
        "approvalId"         uuid,
        "status"             varchar(20)  NOT NULL DEFAULT 'queued',
        "errorReason"        varchar(500),
        "payload"            jsonb,
        "createdAt"          timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"          timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_provider_message_id"
        ON "whatsapp_messages" ("providerMessageId")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_whatsapp_tenant_created"
        ON "whatsapp_messages" ("tenantId", "createdAt" DESC)
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_whatsapp_approval"
        ON "whatsapp_messages" ("approvalId")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "whatsapp_messages"`);
  }
}

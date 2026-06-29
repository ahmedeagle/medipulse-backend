import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat memory: persistent conversations + messages for المساعد التشغيلي.
 * Additive — the existing stateless /ask flow keeps working without these.
 */
export class AddChatConversations1790600000000 implements MigrationInterface {
  name = 'AddChatConversations1790600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "chat_conversations" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId"     uuid NOT NULL,
        "userId"       varchar(64) NULL,
        "title"        varchar(200) NOT NULL DEFAULT 'محادثة جديدة',
        "messageCount" int NOT NULL DEFAULT 0,
        "createdAt"    timestamp NOT NULL DEFAULT NOW(),
        "updatedAt"    timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_conv_tenant_updated"
        ON "chat_conversations" ("tenantId", "updatedAt")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversationId" uuid NOT NULL,
        "tenantId"       uuid NOT NULL,
        "role"           varchar(16) NOT NULL,
        "text"           text NOT NULL,
        "cards"          jsonb NULL,
        "actions"        jsonb NULL,
        "tool"           varchar(48) NULL,
        "createdAt"      timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_msg_conv_created"
        ON "chat_messages" ("conversationId", "createdAt")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_msg_tenant_created"
        ON "chat_messages" ("tenantId", "createdAt")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_chat_msg_tenant_created"`);
    await q.query(`DROP INDEX IF EXISTS "idx_chat_msg_conv_created"`);
    await q.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await q.query(`DROP INDEX IF EXISTS "idx_chat_conv_tenant_updated"`);
    await q.query(`DROP TABLE IF EXISTS "chat_conversations"`);
  }
}

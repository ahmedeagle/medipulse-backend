import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PRD v2 §12 — Append-only audit trail for every approval state transition.
 *
 * Every `pending → modified | approved | rejected | executed | expired`
 * transition writes one row here. This is the regulator-grade record that
 * answers: "WHO approved WHAT, WHEN, with what JUSTIFICATION, and what did
 * the AI originally propose vs the human-edited version?"
 *
 * Append-only: no UPDATE, no DELETE. A trigger could enforce this; for MVP
 * we rely on application discipline (the ApprovalService never updates).
 *
 * Separate from `audit_events` (HTTP-level) and `ai_audit_logs` (GPT calls)
 * because:
 *   - Different read shape (one query: "show the full life of approval X").
 *   - Different retention policy (governance evidence should outlive HTTP logs).
 *   - Different access controls (compliance officers, not ops engineers).
 */
export class AddApprovalEvents1780700100000 implements MigrationInterface {
  name = 'AddApprovalEvents1780700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "approval_events" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "approvalId"   uuid NOT NULL,
        "tenantId"     uuid NOT NULL,
        "agentCode"    varchar(50) NOT NULL,
        "fromStatus"   varchar(20),
        "toStatus"     varchar(20) NOT NULL,
        "actorUserId"  uuid,
        "actorType"    varchar(20) NOT NULL DEFAULT 'user',
        "note"         text,
        "payloadDiff"  jsonb,
        "createdAt"    timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "ck_approval_events_actor_type" CHECK (
          "actorType" IN ('user','agent','system','scheduler')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_approval_events_approval_created"
         ON "approval_events" ("approvalId","createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_approval_events_tenant_created"
         ON "approval_events" ("tenantId","createdAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "approval_events"`);
  }
}

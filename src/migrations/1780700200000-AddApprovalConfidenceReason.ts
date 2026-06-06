import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PRD §14 — store the *why* behind each approval's confidence so the UI can
 * answer "why should I trust this number?" without forcing the user to
 * decode raw signals.
 */
export class AddApprovalConfidenceReason1780700200000 implements MigrationInterface {
  name = 'AddApprovalConfidenceReason1780700200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "confidenceReason" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "approvals" DROP COLUMN IF EXISTS "confidenceReason"`);
  }
}

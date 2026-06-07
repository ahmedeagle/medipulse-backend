import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PRD §13 — Custom Agents Foundation (Phase 4a-1).
 *
 * Extends `agent_definitions` with the columns needed to:
 *   1. Store Arabic system prompts as data (not code) so admins can iterate
 *      without a deploy.
 *   2. Track versioning — every prompt edit bumps `version` and the value is
 *      stamped on audit rows so regulators can reconstruct the exact agent
 *      definition that produced any approval.
 *   3. Distinguish built-in (system) agents from tenant-created custom ones.
 *   4. Optionally scope an agent to a single tenant (multi-tenant SaaS).
 *
 * No data is migrated — built-in rows keep their NULL prompts (the hardcoded
 * code path still runs them) until Phase 4a-2 routes them through the
 * DynamicAgent runner.
 */
export class AddCustomAgentsFoundation1780700400000 implements MigrationInterface {
  name = 'AddCustomAgentsFoundation1780700400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_definitions"
        ADD COLUMN IF NOT EXISTS "systemPromptAr"    text,
        ADD COLUMN IF NOT EXISTS "triggerRules"      jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "outputSubjectType" varchar(40),
        ADD COLUMN IF NOT EXISTS "outputSchema"      jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "version"           integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "isCustom"          boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "tenantScope"       varchar(10) NOT NULL DEFAULT 'global',
        ADD COLUMN IF NOT EXISTS "tenantId"          uuid,
        ADD COLUMN IF NOT EXISTS "createdByUserId"   uuid,
        ADD COLUMN IF NOT EXISTS "parentDefinitionId" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_definitions"
        DROP CONSTRAINT IF EXISTS "agent_definitions_code_key"
    `);
    // Code is no longer globally unique once tenants can create custom agents
    // with the same code in different tenants. Built-ins live in tenantScope='global'
    // with tenantId NULL; partial unique below preserves that invariant.
    await queryRunner.query(`
      DROP INDEX IF EXISTS "agent_definitions_code_idx"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_def_global_code"
        ON "agent_definitions" ("code")
        WHERE "tenantScope" = 'global'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_def_tenant_code"
        ON "agent_definitions" ("tenantId","code")
        WHERE "tenantScope" = 'tenant'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agent_def_scope_tenant"
        ON "agent_definitions" ("tenantScope","tenantId")
    `);

    // Versioning safety: tenantScope must match nullability of tenantId
    await queryRunner.query(`
      ALTER TABLE "agent_definitions"
        ADD CONSTRAINT "chk_agent_def_scope_tenant"
        CHECK (
          ("tenantScope" = 'global' AND "tenantId" IS NULL)
          OR
          ("tenantScope" = 'tenant' AND "tenantId" IS NOT NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_definitions"
        DROP CONSTRAINT IF EXISTS "chk_agent_def_scope_tenant"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agent_def_scope_tenant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_agent_def_tenant_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_agent_def_global_code"`);
    // Don't restore the old unique constraint — destructive on rollback is fine here
    await queryRunner.query(`
      ALTER TABLE "agent_definitions"
        DROP COLUMN IF EXISTS "parentDefinitionId",
        DROP COLUMN IF EXISTS "createdByUserId",
        DROP COLUMN IF EXISTS "tenantId",
        DROP COLUMN IF EXISTS "tenantScope",
        DROP COLUMN IF EXISTS "isCustom",
        DROP COLUMN IF EXISTS "version",
        DROP COLUMN IF EXISTS "outputSchema",
        DROP COLUMN IF EXISTS "outputSubjectType",
        DROP COLUMN IF EXISTS "triggerRules",
        DROP COLUMN IF EXISTS "systemPromptAr"
    `);
  }
}

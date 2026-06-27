import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Provisions every table owned by the dedicated AUDIT database (AuditDataSource).
 *
 * Until now these tables only existed locally via `synchronize:true` in
 * setup-local-db. In any migration-based (production/staging) deploy the audit
 * tables were NEVER created, so `migration:run:audit` was a no-op and every
 * audit write (audit_events, keycloak_auth_events, domain_event_logs, …) was
 * silently dropped by the fire-and-forget queue. This migration closes that gap.
 *
 * Idempotent (CREATE … IF NOT EXISTS) so it is safe to run against a local DB
 * that already has these tables from synchronize.
 */
export class CreateAuditTables1780800000000 implements MigrationInterface {
  name = 'CreateAuditTables1780800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── audit_events — HTTP-level mutation trail (POST/PATCH/DELETE) ──────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_events" (
        "id"          uuid         NOT NULL DEFAULT gen_random_uuid(),
        "tenantId"    uuid,
        "userId"      uuid,
        "resource"    varchar(50)  NOT NULL,
        "method"      varchar(10)  NOT NULL,
        "path"        varchar(255) NOT NULL,
        "statusCode"  int          NOT NULL,
        "latencyMs"   int          NOT NULL,
        "resourceId"  uuid,
        "ipAddress"   varchar(45),
        "userAgent"   text,
        "createdAt"   TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_tenant_created"          ON "audit_events" ("tenantId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_tenant_resource_created" ON "audit_events" ("tenantId", "resource", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_user_created"            ON "audit_events" ("userId", "createdAt")`);

    // ── keycloak_auth_events — login / logout / password / admin events ───────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "keycloak_auth_events" (
        "id"         uuid         NOT NULL DEFAULT gen_random_uuid(),
        "kcEventId"  varchar(100) NOT NULL,
        "eventType"  varchar(60)  NOT NULL,
        "kcUserId"   varchar(36),
        "tenantId"   uuid,
        "sessionId"  varchar(100),
        "ipAddress"  varchar(45),
        "clientId"   varchar(100),
        "details"    jsonb,
        "time"       bigint       NOT NULL,
        CONSTRAINT "PK_keycloak_auth_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_kc_event_id" UNIQUE ("kcEventId")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kc_event_type_time" ON "keycloak_auth_events" ("eventType", "time")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kc_user_time"       ON "keycloak_auth_events" ("kcUserId", "time")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kc_tenant_time"     ON "keycloak_auth_events" ("tenantId", "time")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kc_session"         ON "keycloak_auth_events" ("sessionId")`);

    // ── domain_event_logs — append-only log of every domain event ────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "domain_event_logs" (
        "id"             uuid         NOT NULL DEFAULT gen_random_uuid(),
        "eventType"      varchar(100) NOT NULL,
        "aggregateId"    varchar(36),
        "aggregateType"  varchar(50),
        "tenantId"       uuid,
        "payload"        jsonb        NOT NULL,
        "correlationId"  varchar(36),
        "createdAt"      TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_domain_event_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_del_type_created"   ON "domain_event_logs" ("eventType", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_del_tenant_created" ON "domain_event_logs" ("tenantId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_del_correlation"    ON "domain_event_logs" ("correlationId")`);

    // ── price_snapshots — immutable supplier price-change history ─────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_snapshots" (
        "id"               uuid          NOT NULL DEFAULT gen_random_uuid(),
        "supplierTenantId" uuid          NOT NULL,
        "productId"        uuid          NOT NULL,
        "price"            numeric(10,2) NOT NULL,
        "currency"         varchar(10)   NOT NULL DEFAULT 'SAR',
        "stockAtTime"      int,
        "recordedAt"       TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ps_supplier_product_recorded" ON "price_snapshots" ("supplierTenantId", "productId", "recordedAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ps_product_recorded"          ON "price_snapshots" ("productId", "recordedAt")`);

    // ── weekly_analytics_snapshots — pre-aggregated dashboard rollups ─────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "weekly_analytics_snapshots" (
        "id"                           uuid          NOT NULL DEFAULT gen_random_uuid(),
        "tenantId"                     uuid          NOT NULL,
        "weekStart"                    date          NOT NULL,
        "totalOrders"                  int           NOT NULL DEFAULT 0,
        "totalSpend"                   numeric(12,2) NOT NULL DEFAULT 0,
        "currency"                     varchar(10)   NOT NULL DEFAULT 'SAR',
        "recommendationsGenerated"     int           NOT NULL DEFAULT 0,
        "recommendationsActedOn"       int           NOT NULL DEFAULT 0,
        "recommendationConversionRate" numeric(5,4)  NOT NULL DEFAULT 0,
        "stockoutEvents"               int           NOT NULL DEFAULT 0,
        "topProductId"                 uuid,
        "computedAt"                   TIMESTAMP     NOT NULL,
        CONSTRAINT "PK_weekly_analytics_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_was_tenant_week" ON "weekly_analytics_snapshots" ("tenantId", "weekStart")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "weekly_analytics_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "domain_event_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "keycloak_auth_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_events"`);
  }
}

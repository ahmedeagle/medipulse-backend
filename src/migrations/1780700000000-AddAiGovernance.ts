import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PRD v2 — Phase 1 (AI Workforce Platform): Governance foundation.
 *
 * Two new tables introduce the governance pillar:
 *
 *   1. `agent_definitions` — the registry of named, toggleable AI agents
 *      (Inventory Expert, Purchase Expert, Catalog Expert, …). Each row pins
 *      the agent's identity, capabilities, permission scopes and confidence
 *      threshold. Per-tenant overrides live in `agent_tenant_settings`.
 *      Modeled after Salesforce Einstein Agents / Microsoft Copilot Studio
 *      agent registry — the "what is this agent allowed to do" contract is
 *      DB-driven so admins can disable an agent without a deploy.
 *
 *   2. `approvals` — the 4-state approval lifecycle that every AI-suggested
 *      action MUST pass through before execution. States:
 *           pending → modified → approved → executed
 *                              ↘ rejected
 *      Mirrors ServiceNow Change Requests + Workday Approval Engine.
 *      The `subjectType` + `subjectId` polymorphic pair lets a single queue
 *      cover heterogeneous targets (recommendation, purchase draft, link
 *      suggestion, discount, …) without per-type tables.
 *
 * Audit is intentionally NOT a new table — it reuses the existing
 *   `audit_events` (general) + `ai_audit_logs` (AI-specific) stores. The
 * approvals service writes to both on every transition.
 *
 * Industry alignment: this layout maps 1:1 to what GCC pharmacy SaaS
 * competitors (Aumet, Vezeeta Pharma, Pharmacy360) expose as their
 * "AI Operations Center" — except we keep the human-in-the-loop primitive
 * mandatory (PRD §11) rather than optional.
 */
export class AddAiGovernance1780700000000 implements MigrationInterface {
  name = 'AddAiGovernance1780700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── agent_definitions ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_definitions" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"            varchar(50) NOT NULL UNIQUE,
        "nameEn"          varchar(120) NOT NULL,
        "nameAr"          varchar(120) NOT NULL,
        "category"        varchar(40) NOT NULL,
        "descriptionEn"   text NOT NULL,
        "descriptionAr"   text NOT NULL,
        "skills"          jsonb NOT NULL DEFAULT '[]'::jsonb,
        "permissions"     jsonb NOT NULL DEFAULT '[]'::jsonb,
        "restrictions"    jsonb NOT NULL DEFAULT '[]'::jsonb,
        "outputTypes"     jsonb NOT NULL DEFAULT '[]'::jsonb,
        "defaultEnabled"  boolean NOT NULL DEFAULT true,
        "minConfidence"   decimal(4,2) NOT NULL DEFAULT 0.60,
        "requiresApproval" boolean NOT NULL DEFAULT true,
        "phase"           int NOT NULL DEFAULT 1,
        "iconKey"         varchar(40) NOT NULL DEFAULT 'sparkles',
        "createdAt"       timestamp NOT NULL DEFAULT now(),
        "updatedAt"       timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_definitions_category"
         ON "agent_definitions" ("category", "phase")`,
    );

    // ── agent_tenant_settings (per-tenant toggle + threshold override) ───
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_tenant_settings" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId"        uuid NOT NULL,
        "agentCode"       varchar(50) NOT NULL,
        "enabled"         boolean NOT NULL DEFAULT true,
        "minConfidence"   decimal(4,2),
        "updatedByUserId" uuid,
        "createdAt"       timestamp NOT NULL DEFAULT now(),
        "updatedAt"       timestamp NOT NULL DEFAULT now(),
        UNIQUE ("tenantId", "agentCode")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_tenant_settings_tenant"
         ON "agent_tenant_settings" ("tenantId")`,
    );

    // ── approvals ─────────────────────────────────────────────────────────
    // 4-state machine: status IN ('pending','modified','approved','rejected','executed')
    //  - `modified` means a user edited the draft before approval — the
    //     originalPayload column preserves what the AI proposed, payload
    //     reflects the human-curated version.
    //  - `executed` is recorded when the downstream side-effect (e.g. PO
    //     created, item linked) completes; it's the receipt of action.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "approvals" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId"         uuid NOT NULL,
        "agentCode"        varchar(50) NOT NULL,
        "subjectType"      varchar(40) NOT NULL,
        "subjectId"        uuid NOT NULL,
        "title"            varchar(200) NOT NULL,
        "summary"          text NOT NULL,
        "rationale"        text NOT NULL,
        "confidence"       decimal(4,2) NOT NULL DEFAULT 0,
        "confidenceLabel"  varchar(20) NOT NULL DEFAULT 'low',
        "priority"         varchar(10) NOT NULL DEFAULT 'medium',
        "status"           varchar(20) NOT NULL DEFAULT 'pending',
        "payload"          jsonb NOT NULL DEFAULT '{}'::jsonb,
        "originalPayload"  jsonb,
        "createdByAgent"   varchar(50) NOT NULL,
        "createdAt"        timestamp NOT NULL DEFAULT now(),
        "reviewedByUserId" uuid,
        "reviewedAt"       timestamp,
        "decisionNote"     text,
        "executedAt"       timestamp,
        "executionResult"  jsonb,
        "expiresAt"        timestamp,
        "updatedAt"        timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "ck_approvals_status" CHECK (
          "status" IN ('pending','modified','approved','rejected','executed','expired')
        ),
        CONSTRAINT "ck_approvals_priority" CHECK (
          "priority" IN ('low','medium','high','critical')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_approvals_tenant_status_created"
         ON "approvals" ("tenantId","status","createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_approvals_pending"
         ON "approvals" ("tenantId","priority","createdAt" DESC)
         WHERE "status" = 'pending'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_approvals_subject"
         ON "approvals" ("subjectType","subjectId")`,
    );

    // ── seed the 6 PRD v2 agents ─────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "agent_definitions"
        ("code","nameEn","nameAr","category","descriptionEn","descriptionAr",
         "skills","permissions","restrictions","outputTypes",
         "defaultEnabled","minConfidence","requiresApproval","phase","iconKey")
      VALUES
        ('inventory_expert',
         'Inventory Expert',
         'خبير المخزون',
         'inventory',
         'Prevents stockouts and overstock via demand forecasting and risk detection.',
         'يمنع نفاد المخزون والتكدس عبر توقّع الطلب وكشف المخاطر مبكراً.',
         '["demand_forecasting","stock_analysis","risk_detection"]'::jsonb,
         '["read:inventory","read:sales"]'::jsonb,
         '["no_data_modification","no_purchase_orders"]'::jsonb,
         '["reorder_alert","stockout_risk"]'::jsonb,
         true, 0.65, true, 1, 'package'),

        ('purchase_expert',
         'Purchase Expert',
         'خبير المشتريات',
         'procurement',
         'Drafts purchase orders and recommends suppliers and timing.',
         'يُنشئ مسودّات أوامر الشراء ويقترح الموردين والتوقيت الأمثل.',
         '["po_drafting","supplier_ranking","timing_optimization"]'::jsonb,
         '["read:inventory","read:sales","read:suppliers","draft:purchase_orders"]'::jsonb,
         '["no_auto_send","no_payment_actions"]'::jsonb,
         '["purchase_draft","supplier_suggestion"]'::jsonb,
         true, 0.70, true, 1, 'shopping-cart'),

        ('catalog_expert',
         'Catalog Expert',
         'خبير الكتالوج',
         'catalog',
         'Detects duplicates and improves product-to-catalog linking quality.',
         'يكتشف التكرارات ويحسّن جودة ربط المنتجات بالكتالوج المركزي.',
         '["duplicate_detection","product_matching","catalog_scoring"]'::jsonb,
         '["read:inventory","read:catalog","suggest:links"]'::jsonb,
         '["no_force_link","no_catalog_writes"]'::jsonb,
         '["link_suggestion","duplicate_flag"]'::jsonb,
         true, 0.60, true, 1, 'link'),

        ('dead_stock_expert',
         'Dead Stock Expert',
         'خبير المخزون الراكد',
         'inventory',
         'Identifies non-moving inventory and proposes discount, bundle, transfer or listing.',
         'يحدد المنتجات الراكدة ويقترح خصم أو تجميع أو نقل أو عرض في السوق.',
         '["movement_analysis","liquidation_planning"]'::jsonb,
         '["read:inventory","read:sales"]'::jsonb,
         '["no_price_changes","no_transfers"]'::jsonb,
         '["dead_stock_alert","liquidation_plan"]'::jsonb,
         true, 0.60, true, 2, 'archive'),

        ('expiry_expert',
         'Expiry Expert',
         'خبير الصلاحية',
         'inventory',
         'Reduces expiry loss by prioritising near-expiry batches for action.',
         'يقلل خسائر انتهاء الصلاحية بترتيب الدفعات حسب الأولوية للتصرف فيها.',
         '["expiry_risk_scoring","fefo_optimization"]'::jsonb,
         '["read:inventory","read:sales"]'::jsonb,
         '["no_disposal_actions","no_returns"]'::jsonb,
         '["expiry_alert","fefo_recommendation"]'::jsonb,
         true, 0.70, true, 2, 'clock-alert'),

        ('marketplace_expert',
         'Marketplace Expert',
         'خبير السوق',
         'marketplace',
         'Suggests inter-pharmacy listings for excess stock (future phase).',
         'يقترح عرض الفائض من المخزون في السوق بين الصيدليات (مرحلة لاحقة).',
         '["surplus_detection","listing_pricing"]'::jsonb,
         '["read:inventory"]'::jsonb,
         '["no_auto_listing","no_pricing_writes"]'::jsonb,
         '["marketplace_listing"]'::jsonb,
         false, 0.75, true, 3, 'store')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "approvals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_tenant_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_definitions"`);
  }
}

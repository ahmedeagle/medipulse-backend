# MediPulse — Technical Architecture
### For Investors & CTOs

---

## Executive Summary

MediPulse is a **Healthcare Procurement Intelligence Platform** built as a multi-tenant SaaS on a cloud-native, event-driven architecture. The system combines a deterministic rules engine with LLM-powered explanation, an async job processing layer, and a structured data platform designed to accumulate the proprietary dataset that becomes the long-term competitive moat.

The platform is designed to **scale from 10 to 10,000 tenants without architectural changes** — only infrastructure sizing.

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                        │
│                                                                                  │
│    Pharmacy SPA          Supplier SPA         Admin SPA         Chain Admin      │
│    React 18 + Vite       React 18 + Vite      React 18 + Vite   React 18 + Vite  │
│    TanStack Query v5     TanStack Query v5     Zustand State     OIDC PKCE       │
│    sessionStorage only   sessionStorage only                                     │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │ HTTPS + JWT Bearer (RS256)
┌──────────────────────────────▼──────────────────────────────────────────────────┐
│                         IDENTITY LAYER                                           │
│                                                                                  │
│                         Keycloak 26                                              │
│                         ┌─────────────────────────────────────────────────┐     │
│                         │ Realm: medipulse                                │     │
│                         │ Auth: OIDC Authorization Code + PKCE            │     │
│                         │ Token: RS256 JWT, 5-min access, 30-min idle     │     │
│                         │ Roles: pharmacy-admin | supplier-admin |        │     │
│                         │        system-admin  | chain-admin             │     │
│                         │ Claims: tenantId + organizationId (mappers)    │     │
│                         │ Security: Brute-force protection, pwd policy    │     │
│                         └─────────────────────────────────────────────────┘     │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │ JWKS RS256 (5-min cached, rate-limited)
┌──────────────────────────────▼──────────────────────────────────────────────────┐
│                     HTTP API PROCESS  :3000                                      │
│                     NestJS 10  ·  TypeScript 5  ·  Node.js 20                   │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                        GLOBAL MIDDLEWARE CHAIN                           │   │
│  │  Helmet (security headers) → CORS → Body limit 1MB → ValidationPipe     │   │
│  │  ThrottlerGuard (100 req/60s) → JwtAuthGuard → RolesGuard               │   │
│  │  AuditInterceptor (mutations) → AuditReadInterceptor (sensitive reads)  │   │
│  │  CorrelationIdMiddleware (X-Correlation-ID propagation)                  │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐ ┌──────────────────┐   │
│  │    /auth    │ │/inventory│ │ /supplier  │ │/orders │ │       /ai        │   │
│  │  register   │ │ products │ │  catalog   │ │ create │ │ enqueue generate │   │
│  │  me (sync)  │ │  items   │ │  profile   │ │ status │ │ poll job status  │   │
│  └─────────────┘ └──────────┘ └───────────┘ └────────┘ │ dismiss/feedback │   │
│                                                          └──────────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────────────┐    │
│  │ /procurement │ │/organizations│ │  /analytics│ │       /audit         │    │
│  │  queue/drafts│ │ branches     │ │  pricing   │ │ mutations+reads logs │    │
│  │  approve/rej │ │ chain views  │ │  dashboard │ │ kc-events polling    │    │
│  └──────────────┘ └──────────────┘ └────────────┘ └──────────────────────┘    │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │              EVENT BUS (EventEmitter2 — wildcard, in-process)            │   │
│  │  InventoryUpdated · RecommendationGenerated · OrderStatusChanged ·       │   │
│  │  OrderDelivered · SupplierStockChanged · StockRiskDetected ·             │   │
│  │  AiGovernanceBlocked · RecommendationDismissed                           │   │
│  └─────────────────────┬────────────────────────────────────────────────────┘   │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │ Enqueue jobs (fire-and-forget)
                                ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                       MESSAGE QUEUE LAYER                                      │
│                    Redis 7  ·  BullMQ 5                                        │
│                                                                                │
│  ┌─────────────────────┐  ┌────────────────────┐  ┌─────────────────────┐    │
│  │  ai-recommendations │  │    audit-events     │  │  webhook-delivery   │    │
│  │  • attempts: 3      │  │  • attempts: 5      │  │  • attempts: 5      │    │
│  │  • backoff: exp 5s  │  │  • backoff: exp 1s  │  │  • backoff: exp 5s  │    │
│  │  • concurrency: 5   │  │  • concurrency: 25  │  │  • concurrency: 10  │    │
│  └─────────────────────┘  └────────────────────┘  └─────────────────────┘    │
│                                                                                │
│     Also: supplier-scoring (daily) · analytics-snapshot (weekly)              │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │ Workers consume
┌───────────────────────────────▼───────────────────────────────────────────────┐
│                    WORKER PROCESS  :3001                                       │
│                    NestJS 10  ·  Same codebase, separate entry point           │
│                    Scales independently from API (ECS replicas)                │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                    AI GENERATION PIPELINE                               │  │
│  │                                                                         │  │
│  │  1. Fetch data in parallel (inventory + catalog + 90-day orders)        │  │
│  │                    ↓                                                    │  │
│  │  2. RulesEngine.generateRecommendations()                               │  │
│  │     ├─ SeasonalityEngine    (monthly × category multipliers, cap 50%)  │  │
│  │     ├─ DemandEngine         (avg30/avg90, trend detection ±10%)        │  │
│  │     ├─ RiskEngine           (HIGH/MEDIUM/LOW + reorder qty formula)    │  │
│  │     ├─ SupplierReliability  (acceptance % × 0.40 + fulfillment × 0.40  │  │
│  │     │                        + delivery speed × 0.20 = 0–100 score)   │  │
│  │     └─ ConsumptionPatterns  (fast/slow/dead mover + spike detection)  │  │
│  │                    ↓                                                    │  │
│  │  3. Promise.all() — GPT explanations in parallel                        │  │
│  │     ├─ InputGuard  (10 injection patterns, field length)               │  │
│  │     ├─ GPT-4o-mini-2024-07-18  (max_tokens: 180, temp: 0.3, 15s timeout)│ │
│  │     ├─ OutputGuard (clinical/persona-break pattern detection)          │  │
│  │     └─ Fallback template if GPT fails/blocked                          │  │
│  │                    ↓                                                    │  │
│  │  4. ConfidenceEngine  (historyDepth×0.40 + trendStability×0.25         │  │
│  │                         + seasonalCoverage×0.15 + supplierAvail×0.20) │  │
│  │                    ↓                                                    │  │
│  │  5. Save AiRecommendation + AiAuditLog (tokens, latency, rules)        │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  AuditEventProcessor  ─────────────────→  Audit DB (append-only writes)       │
│  WebhookDeliveryProcessor  ────────────→  External subscriber endpoints       │
│  SupplierReliabilityService  ──────────→  Cron: daily 2am recalculation       │
│  ConsumptionAnalyticsService  ─────────→  Cron: Sunday 3am weekly snapshots   │
│  AnalyticsSnapshotService  ────────────→  Cron: Sunday 4am KPIs               │
│  RecommendationOutcomeListener  ───────→  Cron: daily 5am mark ignored        │
│  KeycloakEventsService  ───────────────→  Cron: every 5min KC auth events     │
└───────────────────────────────────────────────────────────────────────────────┘
                │                              │
┌───────────────▼──────────────┐  ┌────────────▼──────────────────────────────┐
│    MAIN DATABASE             │  │    AUDIT DATABASE                          │
│    PostgreSQL 15             │  │    PostgreSQL 15 (separate instance)       │
│    RDS  ·  20 conn pool      │  │    RDS  ·  5 conn pool                    │
│                              │  │                                            │
│    tenants                   │  │    audit_events         (HTTP mutations)   │
│    users                     │  │    read_access_logs     (sensitive reads)  │
│    products                  │  │    keycloak_auth_events (login/logout)     │
│    inventory_items           │  │    domain_event_logs    (all events)       │
│    supplier_catalog          │  │    (all append-only, no updates/deletes)   │
│    supplier_profiles         │  └────────────────────────────────────────────┘
│    preferred_suppliers       │
│    orders / order_items      │
│    ai_recommendations        │       pgaudit extension → CloudWatch Logs
│    ai_audit_logs             │       (DDL + write + role level, DB-level audit)
│    procurement_drafts        │
│    organizations             │
│    tenant_integrations       │
│    consumption_snapshots     │
│    regional_demand_signals   │
│    supplier_reliability_scrs │
│    price_snapshots           │
│    weekly_analytics_snapshots│
│    product_aliases           │
│    domain_event_logs         │
└──────────────────────────────┘
```

---

## Multi-Tenancy Architecture

Every database query is scoped by `tenantId` extracted from the Keycloak JWT. This is enforced at **three independent layers**:

```
Layer 1 — JWT Validation (JwtStrategy)
  Token missing tenantId claim → 401 Unauthorized immediately
  No tenantId = no request proceeds

Layer 2 — Service Layer Scoping
  Every query: WHERE pharmacyTenantId = :tenantId
  Every mutation: verify resource.tenantId === user.tenantId
  Cross-tenant access → 403 ForbiddenException

Layer 3 — Organization Hierarchy
  CHAIN_ADMIN: scoped to organizationId from JWT
  Can only see branches linked to their organization
```

**No row-level security at DB level** — scoping is in the application. For regulated environments, PostgreSQL RLS can be added as a fourth layer without code changes.

---

## AI Governance Architecture

```
HTTP Request: POST /ai/recommendations/generate
        │
        ├─ AiRateLimiter.assertAllowed()
        │   Redis INCR + EXPIRE (atomic, multi-replica safe)
        │   10 enqueues/hour · 50/day per tenant
        │
        ├─ queue.add(job, { attempts:3, backoff: exponential 5s })
        └─ returns { jobId }  ← HTTP response in <50ms

Worker Process picks up job:
        │
        ├─ [1] Data Fetch  ─────────── Promise.all([inventory, catalog, orders])
        │
        ├─ [2] Rules Engine ──────────────────────────────────────────────────────
        │       Deterministic. No AI. Fully auditable.
        │       Input:  inventory + catalog + order history + reliability scores
        │       Output: RawRecommendation[] sorted by risk level
        │
        ├─ [3] Dismiss old recommendations  (deduplication, fresh set each run)
        │
        ├─ [4] GPT Explanations  ────── Promise.all() — parallel, not sequential
        │       Per recommendation:
        │       ├─ InputGuard.validate()     — 10 injection patterns
        │       ├─ openai.chat.completions.create()
        │       │   model:      gpt-4o-mini-2024-07-18  (pinned, not alias)
        │       │   max_tokens: 180
        │       │   temperature: 0.3
        │       │   timeout:    15,000ms (prevents hung worker slots)
        │       ├─ OutputGuard.assertSafe()  — clinical/persona-break patterns
        │       └─ fallbackExplanation()     — if GPT fails or is blocked
        │
        ├─ [5] ConfidenceEngine.compute()   — 0.0–1.0 composite score
        │
        ├─ [6] Save AiRecommendation + AiAuditLog
        │       (model, promptVersion, tokens, latency, rules, outcome tracking)
        │
        └─ [7] Emit RecommendationGeneratedEvent
                → ProcurementDraftListener (auto-create draft if HIGH risk)
                → WebhookDispatchListener  (notify external subscribers)
                → DomainEventStoreListener (persist to audit DB)
```

**Why rules-first, LLM-second:**
- Recommendations survive OpenAI outages (fallback template)
- Audit trail shows exactly which rules fired for every recommendation
- Compliant with healthcare regulatory requirements (SFDA/MOH explainability)
- Pinned model version prevents silent behavior drift

---

## Prediction Model — Technical Specification

| Component | Method | Formula |
|---|---|---|
| **Demand Trend** | Exponential Moving Average | `avg30 = Σ(qty, last 30d) / 30` · `avg90 = Σ(qty, last 90d) / 90` · Trend = increasing if avg30 > avg90 × 1.10 |
| **Seasonality** | Rule-based Multiplier Table | Category × Month → multiplier (0–0.50). Winter: respiratory +25%, antibiotics +15%. Summer: GI +20%, hydration +30% |
| **Stock Risk** | Threshold Decision Model | `stockDays = quantity / dailyUsage` · HIGH if stockDays < 14 · MEDIUM if stockDays < 21 |
| **Reorder Quantity** | Safety Stock Formula | `(dailyUsage × leadDays) - currentQty + (dailyUsage × 7-day buffer)` |
| **Supplier Reliability** | Composite Score | `(acceptanceRate × 0.40) + (fulfillmentRate × 0.40) + (deliverySpeedScore × 0.20)` · 0–100 |
| **Confidence** | Weighted Factor Model | `(historyDepth × 0.40) + (trendStability × 0.25) + (seasonalCoverage × 0.15) + (supplierAvailability × 0.20)` · 0–1.0 |
| **Consumption Spike** | Moving Average Deviation | Spike if currentWeek > 4-week rolling avg × 1.5 |
| **Dead Stock** | Inactivity Window | Zero consumption in 8+ consecutive weekly snapshots |

**Phase 3 Roadmap (ML):** Once 12+ months of real transaction data exists: Prophet/ARIMA for time-series forecasting, classification models for dead stock, reinforcement learning for procurement timing optimization.

---

## Data Architecture — The Moat

Every interaction accumulates structured data in a schema designed for future ML training:

```
Operational Data (Main DB)          Analytical Data (accumulates over time)
─────────────────────────           ──────────────────────────────────────
orders + order_items          →     price_snapshots          (every price change)
inventory_items               →     consumption_snapshots    (weekly velocity)
ai_recommendations            →     weekly_analytics_snapshots (KPIs per tenant)
supplier_catalog              →     regional_demand_signals  (city-level patterns)
supplier_reliability_scores   →     supplier_reliability_scores (trust scores)

Audit Data (Immutable, Separate DB)
────────────────────────────────────
domain_event_logs      →  every business event (ML training data)
audit_events           →  every API mutation
read_access_logs       →  every sensitive data access
keycloak_auth_events   →  every login/logout/failure
```

After 12 months: **MediPulse knows drug demand patterns by city, season, and pharmacy type that no single pharmacy or distributor has ever seen at this scale.**

---

## Security Architecture

```
Transport:     TLS everywhere. No HTTP in production.
Auth:          Keycloak OIDC · RS256 JWT · PKCE · No passwords in app DB
Token Storage: sessionStorage only (cleared on tab close, XSS-resistant)
Token Renewal: Silent renew via /silent-renew.html (no user disruption)
API Security:  Helmet · CORS · 100 req/60s global throttle · 1MB body limit
Multi-tenancy: tenantId in JWT claim → scoped on every query (3 independent layers)
AI Security:   InputGuard (injection) + OutputGuard (clinical) + versioned prompts
Audit:         Immutable append-only audit DB · 6-layer audit coverage
Infrastructure: IAM roles with OIDC (no long-lived credentials) · Secrets Manager
DB-level:      pgaudit → CloudWatch Logs (DDL + write + role changes)
Compliance:    SFDA-ready audit trail · exportable · role-based access control
```

---

## Infrastructure Architecture (AWS)

```
                        Internet
                           │
                    ┌──────▼──────┐
                    │     ALB     │  HTTPS:443 · ACM cert
                    │  (Route 53) │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           ▼                               ▼
  ┌────────────────┐             ┌──────────────────┐
  │  ECS Fargate   │             │   ECS Fargate    │
  │  medipulse-api │             │medipulse-worker  │
  │  desired: 2    │             │  desired: 1-3    │
  │  CPU: 512      │             │  CPU: 256        │
  │  MEM: 1024     │             │  MEM: 512        │
  │  auto-scale    │             │  scale indep.    │
  │  on CPU > 60%  │             │  from API        │
  └────────┬───────┘             └──────┬───────────┘
           │                            │
           └──────────┬─────────────────┘
                      │
     ┌────────────────┼─────────────────┐
     ▼                ▼                 ▼
┌─────────┐    ┌────────────┐    ┌────────────┐
│   RDS   │    │ ElastiCache│    │  Keycloak  │
│Postgres │    │  Redis 7   │    │  EC2 / EKS │
│   ×2    │    │ (BullMQ +  │    │  (existing)│
│main+audit    │ rate limit)│    │            │
└─────────┘    └────────────┘    └────────────┘

Deployment: GitHub Actions → ECR (no local Docker needed)
            OIDC role assumption (zero long-lived AWS credentials in CI)
            Deploy: worker first → API (safe ordering for queue contracts)
```

---

## Scalability Design

| Dimension | Current Design | Scale-to |
|---|---|---|
| **API throughput** | 2 ECS tasks, auto-scale CPU 60% | 20+ tasks, ALB distributes |
| **AI job throughput** | Worker: 5 concurrent jobs per replica | Add replicas: `docker scale worker=10` |
| **Rate limiting** | Redis INCR (atomic, multi-replica) | Same Redis, no change |
| **DB connections** | Pool: 20 (API) + 10 (worker) | PgBouncer connection pooler |
| **Queue backlog** | BullMQ + Redis sorted sets | Redis Cluster for 10M+ jobs |
| **Webhooks** | 10 concurrent deliveries | Add webhook worker replicas |
| **Tenants** | Row-level tenantId scoping | Read replicas per region |
| **Analytics** | Pre-aggregated weekly snapshots | No operational DB impact ever |

---

## Technology Stack Summary

| Layer | Technology | Version | Why |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | Non-blocking I/O ideal for async-heavy workloads |
| API Framework | NestJS | 10 | Enterprise DI, modular, TypeScript-first |
| Language | TypeScript | 5 | Type safety, refactoring, IDE support |
| Frontend | React + Vite | 18 + 5 | Fast HMR, modern bundling |
| State | TanStack Query v5 + Zustand | Latest | Server state + client state separation |
| ORM | TypeORM | 0.3 | Migration-based, native PostgreSQL types |
| Database | PostgreSQL | 15 | JSONB, partial indexes, pgaudit, battle-tested |
| Queue | BullMQ + Redis | 5 + 7 | Reliable, retryable, pausable, observable |
| Auth | Keycloak | 26 | Enterprise OIDC, SSO-ready, no auth code in app |
| AI | OpenAI gpt-4o-mini | 2024-07-18 (pinned) | Fast, cheap, sufficient for 1-2 sentence output |
| Observability | OpenTelemetry | Latest | Vendor-neutral, auto-instruments everything |
| Security | Helmet + CORS + Throttler | Latest | Defense-in-depth HTTP layer |
| CI/CD | GitHub Actions + ECR | — | OIDC auth, zero stored credentials |
| Infrastructure | AWS ECS Fargate + RDS + ElastiCache | — | Serverless containers, managed data |

---

## Reliability Design

**No single point of failure:**
- API: 2 ECS tasks behind ALB. One dies → traffic reroutes instantly.
- Worker: jobs stay in Redis. Worker restarts → picks up from where it stopped.
- GPT failure → fallback template. Recommendation always saves.
- Redis failure → audit events queue locally, flush on reconnect.
- DB failure → health checks remove task from ALB, ECS replaces it.

**Graceful degradation chain:**
```
OpenAI unavailable    →  Fallback explanation template
Redis unavailable     →  HTTP API continues (queue writes fail silently for audit)
Worker crash          →  Jobs retry with exponential backoff, max 3 attempts
KC JWKS unavailable   →  Cached keys (5-min TTL) serve requests
Audit DB down         →  Main DB unaffected (separate connection pool)
```

**BullMQ dead letter:**
Jobs that fail all 3 attempts → moved to failed set → webhook notification → Bull Board UI shows them → manual retry or inspect.

---

## Integration Readiness

Connector interfaces are fully defined and registered:

```typescript
IErpConnector     { pullInventory(), pushOrder(), getProductMaster(), healthCheck() }
IPosConnector     { getRealtimeStock(), pushRecommendation(), getSalesVelocity(), healthCheck() }
ISupplierApiConnector { getAvailability(), placeOrder(), updatePricing(), healthCheck() }
```

Any ERP vendor (SAP, Oracle, custom) implements the interface → registers in `IntegrationRegistryService` → zero core code changes. The `TenantIntegration` entity stores credentials via AWS Secrets Manager ARN (never in code).

**Webhook system** allows external pharmacy/supplier systems to subscribe to any domain event (OrderDelivered, RecommendationGenerated, StockRiskDetected) with HMAC-SHA256 signed payloads and full delivery history.

---

## Code Quality & Architecture Principles

- **Zero credentials in code.** Secrets Manager for all sensitive values.
- **Immutable audit.** Audit DB is append-only. No UPDATE or DELETE ever runs there.
- **Fail open for recommendations.** GPT down = recommendation still saves with template.
- **Deterministic AI.** Rules engine runs before LLM. Same input = same recommendation.
- **Multi-replica safe.** All shared state (rate limits, job state) in Redis, not in-process.
- **Dependency injection throughout.** Every service is mockable. No hidden globals.
- **TypeScript strict mode.** Zero `any` escape hatches in production paths.
- **Event-driven loose coupling.** Modules communicate through typed events. No direct imports between unrelated domains.

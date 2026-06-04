# MediPulse — Backend

AI-powered pharmacy management SaaS. Decision & Procurement Intelligence for pharmacies and suppliers.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, NestJS 10, TypeScript 5 |
| Database | PostgreSQL 15 (main DB + dedicated audit DB) |
| Auth | Keycloak 26 — OIDC Authorization Code + PKCE, RS256 JWKS |
| Queue | BullMQ 5 + Redis 7 |
| AI | OpenAI gpt-4o-mini with rules engine + governance layer |
| HTTP security | Helmet, CORS, @nestjs/throttler (100 req/60s) |
| Docs | Swagger (dev only) at `/docs` |
| Queue UI | Bull Board at `/admin/queues` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                           │
│          Pharmacy SPA          Supplier SPA          Admin SPA              │
│       (React + OIDC PKCE)                                                   │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │ HTTPS
                    ┌───────────────▼───────────────┐
                    │        Keycloak 26             │
                    │   realm: medipulse             │
                    │   RS256 JWKS — 5 min cache     │
                    │   Roles: pharmacy-admin        │
                    │          supplier-admin        │
                    │          system-admin          │
                    └───────────────┬───────────────┘
                                    │ Bearer JWT (RS256)
         ┌──────────────────────────▼──────────────────────────────┐
         │              HTTP API  (src/main.ts)  :3000             │
         │                                                          │
         │  ┌────────────┐  ┌──────────┐  ┌───────────┐           │
         │  │  /auth     │  │/inventory│  │ /supplier │           │
         │  │  register  │  │ products │  │  catalog  │           │
         │  │  me        │  │ items    │  │  items    │           │
         │  └────────────┘  └──────────┘  └───────────┘           │
         │  ┌────────────┐  ┌──────────┐  ┌───────────┐           │
         │  │  /orders   │  │   /ai    │  │  /audit   │           │
         │  │  PENDING   │  │ enqueue  │  │  query    │           │
         │  │  →ACCEPTED │  │ poll job │  │  (read)   │           │
         │  │  →SHIPPED  │  │ dismiss  │  └───────────┘           │
         │  │  →DELIVERED│  │ feedback │                           │
         │  │  →CANCELLED│  │ audit log│  ┌───────────┐           │
         │  └────────────┘  └──────────┘  │/admin     │           │
         │                                │  /queues  │ Bull Board │
         │  Global: AuditInterceptor       └───────────┘           │
         │  (fire-and-forget → Redis)                              │
         └──────────────────────┬──────────────────────────────────┘
                                │ BullMQ queues (Redis 7)
              ┌─────────────────┴──────────────────────┐
              │           ai-recommendations            │
              │           audit-events                  │
              └─────────────────┬──────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────────────┐
         │           Worker Process  (src/worker.ts)  :3001        │
         │                                                          │
         │  AiGenerationProcessor          AuditEventProcessor     │
         │  ├ concurrency: 5              ├ concurrency: 25        │
         │  ├ attempts: 3                 ├ attempts: 5            │
         │  ├ backoff: exponential 5s     ├ writes audit DB only   │
         │  └ calls AiService.run()       └ never touches main DB  │
         └──────────┬──────────────────────────┬───────────────────┘
                    │                          │
         ┌──────────▼──────────┐   ┌───────────▼───────────────────┐
         │  Main PostgreSQL DB │   │     Audit PostgreSQL DB       │
         │  medipulse          │   │     medipulse_audit            │
         │                     │   │                               │
         │  tenants            │   │  audit_events (append-only)   │
         │  users              │   │  ─ tenantId, userId           │
         │  products           │   │  ─ resource, method, path     │
         │  inventory_items    │   │  ─ statusCode, latencyMs      │
         │  supplier_catalog   │   │  ─ ipAddress, userAgent       │
         │  orders             │   │  ─ resourceId, createdAt      │
         │  order_items        │   │  (no updates, no deletes)     │
         │  ai_recommendations │   └───────────────────────────────┘
         │  ai_audit_logs      │
         └─────────────────────┘
```

### AI Pipeline

```
POST /ai/recommendations/generate
        │
        ├─ AiRateLimiter.assertAllowed()   (10/hr, 50/day per tenant — in-process)
        ├─ queue.add(job, { attempts:3, backoff: exponential 5s })
        └─ returns { jobId, status: 'queued' }  ← immediate HTTP response

[Worker picks up job]
        │
        ├─ Fetch inventory + supplier catalog + 90-day order history  (Promise.all)
        ├─ RulesEngine
        │     ├─ SeasonalityEngine  (month × category multipliers, capped 50%)
        │     ├─ DemandEngine       (avg30 / avg90, trend detection)
        │     └─ RiskEngine         (HIGH / MEDIUM / LOW, suggested reorder qty)
        │
        ├─ Dismiss previous active recommendations (deduplication)
        │
        └─ For each raw recommendation:
              ├─ InputGuard        (10 injection patterns, field length limits)
              ├─ OpenAI gpt-4o-mini  (max_tokens:120, temp:0.3)
              ├─ OutputGuard       (clinical / persona-break / length checks)
              ├─ ConfidenceEngine  (0.0–1.0 score: historyDepth×0.40, trendStability×0.25,
              │                    seasonalCoverage×0.15, supplierAvailability×0.20)
              └─ Save AiRecommendation + AiAuditLog

GET /ai/recommendations/job/:jobId
        └─ returns { status: waiting|active|completed|failed, progress, recommendations? }
```

### Audit Pipeline

```
Any POST / PATCH / DELETE request
        │
        ├─ AuditInterceptor.intercept()   (global, ~0.1ms)
        ├─ queue.add('audit-events', payload)   ← fire-and-forget, never throws
        └─ HTTP response returned immediately

[Worker — AuditEventProcessor, concurrency:25]
        │
        └─ auditRepo.save(event)   → audit DB only
```

### Order State Machine

```
PENDING → ACCEPTED → SHIPPED → DELIVERED  (terminal)
        ↘                              
         CANCELLED                      (terminal)

On DELIVERED: inventory quantities incremented atomically (same QueryRunner transaction).
```

### Multi-tenancy

Every query is scoped by `tenantId` extracted from the Keycloak JWT `tenantId` claim (set via KC protocol mapper). Tokens without a `tenantId` are rejected at the JWT strategy level.

---

## Prerequisites

- Node.js 20+
- Docker + Docker Compose
- A Keycloak instance (use existing `gx1-auth` or spin up local — see below)
- An OpenAI API key

---

## Installation

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd medipulse-backend
npm install
```

### 2. Start infrastructure (PostgreSQL + Redis + Keycloak)

```bash
# From the project root (docker-compose.yml)
docker compose up -d

# Services started:
#   postgres:15-alpine  → localhost:5432
#   redis:7-alpine      → localhost:6379  (password protected)
#   keycloak:26         → localhost:8080  (comment out if using gx1-auth)
```

### 3. Create the audit database

```bash
docker exec -it <postgres-container> psql -U postgres -c "CREATE DATABASE medipulse_audit;"
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — minimum required:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Main app PostgreSQL connection string |
| `AUDIT_DATABASE_URL` | Separate audit PostgreSQL connection string |
| `KC_URL` | Keycloak base URL (e.g. `http://localhost:8080`) |
| `KC_REALM` | Keycloak realm name (`medipulse`) |
| `KC_CLIENT_ID` | Backend confidential client ID (`medipulse-api`) |
| `KC_CLIENT_SECRET` | Backend confidential client secret |
| `REDIS_HOST` | Redis host |
| `REDIS_PASSWORD` | Redis password |
| `OPENAI_API_KEY` | OpenAI API key |
| `BULL_BOARD_API_KEY` | Secret key for Bull Board UI access |
| `FRONTEND_URL` | CORS origin (e.g. `http://localhost:5173`) |

### 5. Configure Keycloak

Follow `docs/keycloak-setup.md` for the full setup. Summary:

1. Create realm `medipulse`
2. Set token lifetimes: access=5min, SSO idle=30min
3. Enable brute force protection (5 failures, 15min max wait)
4. Set password policy (min 8 chars, uppercase, digit, special, history 5)
5. Create realm roles: `pharmacy-admin`, `supplier-admin`, `system-admin`
6. Create public client `medipulse-spa` (Authorization Code + PKCE)
7. Create confidential client `medipulse-api` (service account, `manage-users` role)
8. Add protocol mapper on `medipulse-api` client: User Attribute `tenantId` → JWT claim `tenantId`

---

## Running

### Development (two terminals)

```bash
# Terminal 1 — HTTP API
npm run start:dev

# Terminal 2 — Worker (separate process)
npm run worker:dev
```

### Production

```bash
npm run build

# Run as separate processes / containers
npm run start:prod   # HTTP API  → :3000
npm run worker:prod  # Worker    → :3001 (health only)
```

### Docker Compose (all services)

```bash
# docker-compose.yml should define api, worker, postgres, redis, keycloak services
docker compose up --scale worker=2   # scale workers independently from API
```

---

## Processes & Ports

| Process | Entry point | Port | Purpose |
|---|---|---|---|
| HTTP API | `src/main.ts` | `PORT` (3000) | Public REST API, enqueues jobs |
| Worker | `src/worker.ts` | `WORKER_PORT` (3001) | Processes AI + Audit queues |

The worker has **zero HTTP middleware** (no CORS, no Swagger, no rate limiting). Port 3001 serves only `/health` and `/health/ready` for container probes.

---

## API Reference

Base path: `/api/v1`

### Auth
| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/auth/register` | system_admin | Onboard new pharmacy or supplier |
| `GET` | `/auth/me` | authenticated | Get profile (synced from KC token) |

### Inventory
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/inventory/products` | any | List all products |
| `POST` | `/inventory/products` | pharmacy_admin | Create product |
| `GET` | `/inventory/items` | pharmacy_admin | List own inventory |
| `POST` | `/inventory/items` | pharmacy_admin | Add inventory item |
| `PATCH` | `/inventory/items/:id` | pharmacy_admin | Update quantity / threshold |
| `DELETE` | `/inventory/items/:id` | pharmacy_admin | Soft-delete item |

### Supplier Catalog
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/supplier/catalog` | any | Browse all supplier listings |
| `POST` | `/supplier/catalog` | supplier_admin | Add product to own catalog |
| `PATCH` | `/supplier/catalog/:id` | supplier_admin | Update price / stock |
| `DELETE` | `/supplier/catalog/:id` | supplier_admin | Soft-delete listing |

### Orders
| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/orders` | pharmacy_admin | Place order from supplier |
| `GET` | `/orders` | pharmacy_admin, supplier_admin | List own orders |
| `GET` | `/orders/:id` | pharmacy_admin, supplier_admin | Order detail |
| `PATCH` | `/orders/:id/status` | supplier_admin | Advance order state machine |

### AI Recommendations
| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/ai/recommendations/generate` | pharmacy_admin | Enqueue generation — returns `{ jobId }` |
| `GET` | `/ai/recommendations/job/:jobId` | pharmacy_admin | Poll job status + results |
| `GET` | `/ai/recommendations` | pharmacy_admin | List active recommendations |
| `PATCH` | `/ai/recommendations/:id/dismiss` | pharmacy_admin | Dismiss |
| `PATCH` | `/ai/recommendations/:id/feedback` | pharmacy_admin | Submit feedback (1 / -1) |
| `GET` | `/ai/audit-logs` | pharmacy_admin | Last 100 generation audit logs |

### Audit
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/audit` | pharmacy_admin, system_admin | Query audit events (scoped by role) |

Query params: `resource`, `userId`, `from` (ISO 8601), `to`, `limit` (max 200), `offset`

### Health
| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness — is the process alive |
| `GET` | `/health/ready` | Readiness — DB connection check |

### Bull Board (Queue UI)
```
GET /admin/queues
Authorization: Bearer <BULL_BOARD_API_KEY>
```

---

## Keycloak Auth Flow

```
1. User opens SPA  →  OIDC Authorization Code + PKCE redirect to Keycloak
2. Keycloak authenticates  →  issues RS256 JWT with tenantId + realm_access.roles claims
3. SPA stores token in sessionStorage (never localStorage)
4. Every API request: Authorization: Bearer <token>
5. JWT strategy validates token via JWKS endpoint (5-min cached)
6. tenantId claim scopes every DB query automatically
7. Silent renew via /silent-renew.html (automaticSilentRenew: true)
```

---

## Environment Variables Reference

```bash
# Process
NODE_ENV=development
PORT=3000
WORKER_PORT=3001

# Databases
DATABASE_URL=postgresql://user:pass@host:5432/medipulse
AUDIT_DATABASE_URL=postgresql://user:pass@host:5432/medipulse_audit

# Keycloak
KC_URL=http://localhost:8080
KC_REALM=medipulse
KC_CLIENT_ID=medipulse-api
KC_CLIENT_SECRET=<confidential-client-secret>

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<password>

# OpenAI
OPENAI_API_KEY=sk-...

# Bull Board
BULL_BOARD_API_KEY=<strong-random-key>

# CORS
FRONTEND_URL=http://localhost:5173
```

---

## Project Structure

```
src/
├── main.ts                    # HTTP API bootstrap (Bull Board mounted here)
├── worker.ts                  # Worker process bootstrap
├── app.module.ts              # Main app module
├── worker-app.module.ts       # Worker-only module (no HTTP middleware)
│
├── auth/
│   ├── strategies/jwt.strategy.ts          # JWKS RS256 validation
│   ├── services/keycloak-admin.service.ts  # KC Admin REST API client
│   ├── auth.service.ts                     # register + syncProfile
│   └── entities/  user.entity.ts, tenant.entity.ts
│
├── inventory/
│   ├── inventory.service.ts
│   └── entities/  product.entity.ts, inventory-item.entity.ts
│
├── supplier/
│   ├── supplier.service.ts
│   └── entities/  supplier-catalog-item.entity.ts
│
├── orders/
│   ├── orders.service.ts      # State machine + atomic delivery→inventory update
│   └── entities/  order.entity.ts, order-item.entity.ts
│
├── ai/
│   ├── ai.service.ts          # enqueueGeneration, runGeneration, getJobStatus
│   ├── ai.module.ts           # HTTP app: queue + service (no processor)
│   ├── ai-worker.module.ts    # Worker: processor + all deps
│   ├── ai-generation.processor.ts   # BullMQ processor (concurrency:5, retry×3)
│   ├── rules.engine.ts        # SeasonalityEngine + DemandEngine + RiskEngine
│   └── governance/
│       ├── input-guard.ts     # Injection pattern detection
│       ├── output-guard.ts    # Clinical / persona-break detection
│       ├── confidence.engine.ts
│       ├── rate-limiter.ts    # 10/hr, 50/day per tenant
│       └── system-prompt.ts  # Versioned locked prompt (v1.2)
│
├── audit/
│   ├── audit.interceptor.ts        # Global HTTP interceptor, fire-and-forget
│   ├── audit-event.processor.ts    # BullMQ processor (concurrency:25) → audit DB
│   ├── audit.service.ts            # Read API with filtering
│   ├── audit.module.ts             # HTTP app: queue + interceptor + read API
│   ├── audit-worker.module.ts      # Worker: processor only
│   └── entities/  audit-event.entity.ts  (append-only, separate DB)
│
├── admin/                     # Tenant management (system_admin only)
├── health/                    # /health  /health/ready
└── common/
    ├── guards/    jwt-auth.guard.ts, roles.guard.ts
    ├── decorators/  current-user.ts, roles.ts
    └── enums/     role.enum.ts, order-status.enum.ts, recommendation-type.enum.ts
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Keycloak for auth | RS256 JWKS, brute-force protection, password policy, MFA — zero auth code in the app |
| Worker as separate process | Crash isolation — GPT timeouts / OOM never affect HTTP response times. Scale independently. |
| Dedicated audit DB | Audit writes never contend with main DB. Can be independently backed up / retained. |
| BullMQ for AI queue | Async GPT calls (5–20s each) return immediately to the HTTP client. Retry/backoff handles transient OpenAI failures. |
| Fire-and-forget audit interceptor | `~0.1ms` overhead per request. Redis down → audit event dropped, not the request. |
| Row-level multi-tenancy | `tenantId` from JWT claim enforced at every query. No cross-tenant leakage possible at service layer. |
| Atomic order delivery | Inventory update happens in the same `QueryRunner` transaction as the status change — no partial state. |
| GPT fallback template | Rules engine result is always saved regardless of OpenAI availability. `explanationFromGpt: false` flags it. |
| sessionStorage for tokens | Follows GX1 platform convention — tokens never survive tab close, never accessible from other origins. |

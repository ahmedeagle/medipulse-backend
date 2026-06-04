# MediPulse — MVP Master Plan

> **Product positioning:** Decision & Procurement Intelligence System for pharmacies and suppliers.
> Not a marketplace. Not an ERP. The differentiator is **intelligence inside procurement**.

---

## 1. Problem Statement

| Pain | Impact |
|---|---|
| Recurring drug shortages | Lost sales + patient risk |
| Excess inventory (dead stock) | Capital locked, expiry losses |
| Manual, gut-feel purchasing | No data, no consistency |
| Multiple supplier prices, no visibility | Overpaying by 10–30% |
| No demand foresight | Reactive, not proactive |

---

## 2. Product Vision (MVP)

**MediPulse** is a SaaS platform that gives pharmacies:

1. **Operational clarity** — know exactly what's in stock, what's low, what's expiring
2. **Procurement intelligence** — know *when* to order, *from whom*, and *how much*
3. **AI explanations** — get plain-language reasoning behind every recommendation

The AI is **not autonomous**. It suggests, explains, and recommends. Humans decide.

---

## 3. Out of Scope (MVP — non-negotiable)

| ❌ NOT in MVP | Reason |
|---|---|
| Marketplace / checkout / payments | Scope creep, not differentiator |
| Hospital / government integrations | Complex, slow procurement |
| ML models / training pipelines | Pharma data in early stage is too messy for ML |
| Advanced data science infrastructure | Over-engineering, fake accuracy |
| Complex ERP replacement | Wrong positioning |
| Multi-currency / multi-region billing | Post-product-market-fit |

---

## 4. Users & Roles

| Role | Access |
|---|---|
| `pharmacy_admin` | Inventory, orders, AI recommendations, supplier catalog (read) |
| `supplier_admin` | Product catalog management, incoming order handling |
| `system_admin` | Platform management, tenants, users |

---

## 5. MVP Modules

### 5.1 Inventory Management
- Add / update / soft-delete inventory items
- Low-stock alerts (`quantity <= minThreshold`)
- Expiry date tracking
- Product master catalog (global)

### 5.2 Supplier Catalog
- Suppliers list and manage their products + prices
- Pharmacies browse all available supplier products
- Price per product, availability flag, stock level

### 5.3 Ordering System
Order lifecycle:
```
PENDING → ACCEPTED → SHIPPED → DELIVERED
PENDING → CANCELLED
```
- Pharmacy creates order (select supplier, add line items)
- Supplier accepts or rejects
- Status tracked through delivery

### 5.4 Intelligence Layer ← **Core Differentiator**

#### A. Seasonality Engine (Rule-Based)

Monthly demand multipliers by drug category:

| Season | Months | Category | Multiplier |
|---|---|---|---|
| Winter | Nov–Feb | Respiratory | +25% |
| Winter | Nov–Feb | Antibiotics | +15% |
| Summer | Jun–Aug | GI / Digestive | +20% |
| Summer | Jun–Aug | Hydration / IV | +30% |
| Ramadan | varies | Chronic (diabetes, BP) | +20% |

Logic: `adjusted_demand = base_demand × (1 + seasonal_multiplier)`

#### B. Demand Trend Detection

From order history (last 30 / 90 days):

```
avg_30_days_usage  = total ordered in last 30d / 30
avg_90_days_usage  = total ordered in last 90d / 90
trend              = increasing | stable | decreasing
  increasing       if avg_30 > avg_90 * 1.1
  decreasing       if avg_30 < avg_90 * 0.9
  stable           otherwise
```

#### C. Risk Signal

```
daily_usage        = avg_30_days_usage (or fallback avg_90)
stock_days         = current_quantity / daily_usage
expected_need_days = demand_days_adjusted_for_season

risk = HIGH    if stock_days < expected_need_days
risk = MEDIUM  if stock_days < expected_need_days * 1.5
risk = LOW     otherwise
```

#### D. Reorder Quantity Suggestion

```
suggested_reorder = (expected_need_days * daily_usage) - current_quantity + safety_buffer
safety_buffer     = avg_30_days_usage * 7  (one week buffer)
```

#### E. Price Comparison

For each low-stock item: show all supplier listings ranked by price, with % savings vs most expensive.

#### F. Alternative Drug Suggestion

If a product has zero available supplier listings: find products with same `genericName` that ARE available. Rank by supplier count.

#### G. GPT Explanation Layer

Rules engine outputs structured signals. GPT (`gpt-4o-mini`) converts them into plain-language explanations.

**GPT is NOT the brain.** It is the voice.

Example:

```
Rules engine output:
{
  risk: "HIGH",
  stockDays: 6,
  trend: "increasing",
  seasonMultiplier: 1.25,
  suggestedReorder: 200,
  cheapestSupplier: "PharmaCo",
  savings: "12%"
}

GPT output:
"Your Amoxicillin stock will likely run out in ~6 days.
Demand is trending upward and winter typically increases
antibiotic consumption by 25%. We recommend ordering 200
units now — PharmaCo offers the best price at 12% below
the market average."
```

### 5.5 Multi-Tenant & Auth
- JWT-based authentication (access + refresh)
- Role-based access control (`pharmacy_admin`, `supplier_admin`, `system_admin`)
- Full tenant data isolation — cross-tenant data leakage is a hard blocker

---

## 6. System Architecture

### 6.1 Stack

| Layer | Technology |
|---|---|
| Backend | NestJS 10 (TypeScript), TypeORM 0.3 |
| Frontend | React 18 + Vite, TanStack Query, Tailwind |
| Database | PostgreSQL 15 |
| Auth | Passport JWT (HS256), bcryptjs |
| AI | OpenAI gpt-4o-mini + Rules Engine (TypeScript) |
| Cache | Redis (in-process Map for MVP — swap-for-Redis documented) |
| API docs | Swagger at `/docs` |

### 6.2 Project Structure

```
medipulse-backend/          # NestJS API
medipulse-frontend/         # React SPA
```

### 6.3 Backend Module Map

```
src/
├── common/
│   ├── enums/              role, order-status, tenant-type, recommendation-type
│   ├── guards/             JwtAuthGuard, RolesGuard
│   └── decorators/         @Roles(), @CurrentUser()
├── auth/                   JWT, register, login, tenant creation
├── inventory/              product catalog, inventory CRUD, low-stock
├── supplier/               supplier catalog, pricing
├── orders/                 order lifecycle, status machine
├── ai/                     rules engine, seasonality, demand, GPT
└── admin/                  system admin panel
```

### 6.4 Database Schema

```sql
tenants          id, name, slug, type(pharmacy|supplier), isActive, createdAt
users            id, tenantId, email, passwordHash, firstName, lastName, role, isActive, createdAt
products         id, name, genericName, category, unit, barcode, description, createdAt
inventory_items  id, pharmacyTenantId, productId, quantity, minThreshold, expiryDate, deletedAt, updatedAt
supplier_catalog id, supplierTenantId, productId, price, currency, isAvailable, stock, deletedAt, updatedAt
orders           id, pharmacyTenantId, supplierTenantId, status, notes, totalAmount, createdAt, updatedAt
order_items      id, orderId, productId, quantity, unitPrice, totalPrice
ai_recommendations id, pharmacyTenantId, type, productId, payload(jsonb), explanation, riskLevel, isDismissed, createdAt
```

---

## 7. Scalability & Resilience Design

### 7.1 Tenant Isolation
- Every query is scoped by `tenantId` — enforced at service layer, never in the controller
- No global queries that mix tenant data are allowed
- Add PostgreSQL Row-Level Security (RLS) post-MVP for defense-in-depth

### 7.2 Soft Deletes
- All user-facing entities use `deletedAt` timestamp (never hard-delete)
- `WHERE deletedAt IS NULL` on every query

### 7.3 Stateless API
- No server-side session state — JWT only
- Any replica can serve any request
- Horizontal scaling: spin up N backend instances behind a load balancer

### 7.4 In-Process vs Redis
- Rate limiters and idempotency keys are in-process `Map` for MVP
- **Documented as swap-for-Redis** — same API, single file change for multi-replica correctness
- Add `REDIS_URL` env var + `ioredis` when moving to multi-replica

### 7.5 AI Layer Resilience
- Rules engine has **zero external dependencies** — always runs
- GPT call is **wrapped in try/catch** — if OpenAI is down, rules output is saved with a fallback explanation
- GPT is never on the critical read path — recommendations are **pre-generated and stored**

### 7.6 Database
- Use connection pooling (TypeORM default pool: 10 connections, tune for prod)
- Add `pg_stat_statements` + slow query logging in prod
- Indexes: `tenantId` on inventory_items, orders, ai_recommendations; `productId` on supplier_catalog
- Migrations: TypeORM `synchronize: false` in production, use explicit migration files

### 7.7 Future Scalability Path (post-MVP)

| When | Add |
|---|---|
| Multi-replica deployment | Swap in-process stores → Redis |
| High recommendation volume | Queue GPT calls with BullMQ |
| Real-time order updates | WebSocket gateway (NestJS built-in) |
| Heavy analytics | Read replica or separate analytics DB |
| ML readiness | Collect `product_usage_log` table from day 1 (already in schema design) |

---

## 8. API Summary

| Prefix | Module | Key endpoints |
|---|---|---|
| `/api/v1/auth` | Auth | register, login, me |
| `/api/v1/inventory` | Inventory | CRUD, low-stock |
| `/api/v1/products` | Products | list, create |
| `/api/v1/supplier/catalog` | Supplier | CRUD catalog |
| `/api/v1/orders` | Orders | create, list, status update |
| `/api/v1/ai/recommendations` | AI | generate, list, dismiss |
| `/api/v1/admin` | Admin | tenants, users |

All responses: camelCase JSON. All protected routes: `Authorization: Bearer <token>`.

---

## 9. AI Governance Architecture

> AI must be perfectly controlled. It suggests. It explains. It never acts.

### 9.1 Governance Layers (Defense-in-Depth)

```
User request
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Rate Limiter           10 gen/hour · 50 gen/day        │
│     per tenant · in-process Map → swap-for-Redis           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Rules Engine           100% deterministic               │
│     SeasonalityEngine · DemandEngine · RiskEngine          │
│     No external deps — always runs, never fails            │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Input Guard            Before every GPT call            │
│     Injection pattern detection · field length cap         │
│     User-supplied strings sanitized before embedding       │
│     → Block → fall back to template, never crash           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  4. GPT (gpt-4o-mini)      Explanation layer ONLY          │
│     Locked system prompt (versioned, read-only constant)   │
│     max_tokens: 120 · temperature: 0.3                     │
│     Scope: pharmacy procurement — no medical advice        │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Output Guard           After every GPT response         │
│     Medical/clinical term filter · persona-break check     │
│     Length enforcement (10–400 chars)                      │
│     → Block → fall back to template, never expose output   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  6. Confidence Engine      Data-quality scoring             │
│     historyDepth + trendStability + seasonal + suppliers   │
│     Score 0.0–1.0 · Label: high / medium / low            │
│     Shown to user so they know HOW reliable the signal is  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  7. Audit Log              Immutable, never deleted         │
│     model · promptVersion · tokens · latency · status     │
│     rules triggered · outputs blocked · error messages     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
                     Saved recommendation
                  (payload = raw rules output,
                   explanation = guarded GPT text,
                   explanationFromGpt = true/false)
```

### 9.2 System Prompt Governance

- Prompt is a **read-only TypeScript constant** — never built from user input
- **Versioned** (`CURRENT_PROMPT_VERSION = 'v1.x'`) — every audit log records which version was active
- Scope constraints baked in: no dosage advice, no clinical guidance, no markdown, 2 sentences max
- Any prompt change **requires version bump** — creates an audit paper trail

### 9.3 Human-in-the-Loop (Non-Negotiable)

| AI Can | AI Cannot |
|---|---|
| Suggest reorder quantities | Create orders |
| Recommend a supplier | Select a supplier |
| Flag low stock | Modify inventory |
| Explain a price comparison | Change prices |
| Propose alternatives | Substitute products |

The AI layer is **read-only**. Every action requires an explicit user click.

### 9.4 Fallback Chain

```
GPT available + output safe   → use GPT explanation   (explanationFromGpt: true)
GPT available + output unsafe → use template fallback (explanationFromGpt: false)
GPT down / API error          → use template fallback (explanationFromGpt: false)
Input guard blocks            → use template fallback (explanationFromGpt: false)
Rules engine                  → ALWAYS runs (no external deps)
```

The recommendation is **always saved**. The explanation quality degrades gracefully — it never crashes.

### 9.5 Feedback Loop

`PATCH /ai/recommendations/:id/feedback` — pharmacy admin rates each recommendation:
- `score: 1` → helpful
- `score: -1` → not helpful
- `note` → optional free text

Feedback is stored on `ai_recommendations.feedbackScore` and is the foundation for future rule tuning.

### 9.6 Audit Log Fields

| Field | Purpose |
|---|---|
| `model` | Which LLM was used |
| `promptVersion` | Which system prompt version |
| `status` | success / failed / blocked_input / blocked_output / rate_limited |
| `recommendationsGenerated` | How many recs were saved |
| `totalInputTokens` | Cost tracking |
| `totalOutputTokens` | Cost tracking |
| `latencyMs` | Performance monitoring |
| `rulesTriggered` | Which rule types fired |
| `outputsBlocked` | How many GPT outputs were rejected by OutputGuard |
| `errorMessage` | Full error if status = failed |

### 9.7 Rate Limit Design

| Window | Limit | Rationale |
|---|---|---|
| Hourly | 10 per pharmacy | Prevents abuse while allowing normal workflow |
| Daily | 50 per pharmacy | Cost cap |

In-process `Map` for MVP. Redis swap: same interface, change constructor injection only.

---

## 10. AI Intelligence — Implementation Detail

### Intelligence Engine Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                    AI Service                           │
│                                                         │
│  1. Fetch inventory (this pharmacy)                     │
│  2. Fetch order history (last 90 days)                  │
│  3. Fetch supplier catalog                              │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │             Rules Engine                        │   │
│  │                                                 │   │
│  │  SeasonalityEngine.getMultiplier(month, cat)    │   │
│  │  DemandEngine.getTrend(orderHistory, productId) │   │
│  │  RiskEngine.assess(stockDays, demandDays)       │   │
│  │  ReorderEngine.suggestQty(demand, stock, buf)   │   │
│  │  PriceEngine.compare(catalog, productId)        │   │
│  │  AlternativeEngine.find(catalog, genericName)   │   │
│  └─────────────────────────────────────────────────┘   │
│                        │                               │
│              RawRecommendation[]                        │
│                        │                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │            GPT Explanation Layer                │   │
│  │  gpt-4o-mini — 1-2 sentence plain explanation   │   │
│  │  Fallback: template string if OpenAI down       │   │
│  └─────────────────────────────────────────────────┘   │
│                        │                               │
│             Save to ai_recommendations                  │
└─────────────────────────────────────────────────────────┘
```

### Recommendation Types

| Type | Trigger | Key payload fields |
|---|---|---|
| `reorder` | quantity ≤ minThreshold | deficit, riskLevel, stockDays, suggestedQty, trend |
| `price_comparison` | low stock + multiple suppliers | options[]{supplier, price, savings%} |
| `alternative` | product unavailable from all suppliers | alternatives[]{productName, supplierCount} |

---

## 10. Frontend Screen Map

### Pharmacy Dashboard (`/pharmacy`)
- Stats: total items, low stock count, pending orders, AI recommendations
- Low stock table (top 5)
- Recent orders (last 5) with status badge
- "Generate AI Recommendations" button

### Pharmacy — Inventory (`/pharmacy/inventory`)
- Full inventory table with search
- Add / Edit / Delete inventory items
- Low / Normal badge per item
- Expiry warnings

### Pharmacy — Supplier Catalog (`/pharmacy/catalog`)
- Browse all supplier products
- Price, availability, stock per supplier
- Jump to create order

### Pharmacy — Orders (`/pharmacy/orders`)
- Create order: select supplier → add line items → confirm
- Order list with status badges
- Order detail modal with items

### Pharmacy — AI Recommendations (`/pharmacy/ai`)
- Cards per recommendation
- Type badge (REORDER / PRICE COMPARISON / ALTERNATIVE)
- Risk level badge (HIGH / MEDIUM / LOW)
- Trend indicator (↑ / → / ↓)
- Plain-language GPT explanation
- Dismiss button
- "Generate New" button

### Supplier Dashboard (`/supplier`)
- Stats: catalog size, pending orders, total orders

### Supplier — Catalog (`/supplier/catalog`)
- Add / edit / remove products
- Toggle availability

### Supplier — Orders (`/supplier/orders`)
- Accept / Reject pending orders
- Mark as Shipped / Delivered

### Admin Panel (`/admin`)
- Tenants list + add tenant
- Users list + deactivate

---

## 11. 8-Week Delivery Plan

| Week | Backend | Frontend |
|---|---|---|
| 1 | DB schema, entities, migrations, TypeORM config | Project setup, Vite, Tailwind, auth store |
| 2 | Auth module (JWT, multi-tenant register/login) | Login page, role-based routing, layout |
| 3 | Inventory module (CRUD + low-stock) | Inventory page (table, CRUD modals) |
| 4 | Supplier module (catalog) | Supplier catalog page (both roles) |
| 5 | Orders module (full state machine) | Orders pages (create flow + status actions) |
| 6 | AI module: SeasonalityEngine + DemandEngine + RulesEngine | AI Recommendations page (cards + dismiss) |
| 7 | GPT explanation layer + recommendation storage | Polish, loading states, error handling |
| 8 | Admin module + end-to-end testing | Admin panel + final QA |

---

## 12. Environment Variables

```bash
# Backend (.env)
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/medipulse
JWT_SECRET=change-me-in-production-32-chars-min
JWT_EXPIRES_IN=7d
OPENAI_API_KEY=sk-...
FRONTEND_URL=http://localhost:5173

# Frontend (.env)
VITE_API_URL=http://localhost:3000/api/v1
```

---

## 13. Definition of Done (MVP)

- [ ] 5–10 pharmacies onboarded and using inventory
- [ ] Real orders flowing from pharmacy → supplier
- [ ] AI recommendations generating with GPT explanations
- [ ] Seasonality + demand trend signals visible in recommendations
- [ ] Zero cross-tenant data leakage (manual QA)
- [ ] Swagger docs complete at `/docs`
- [ ] Frontend builds with 0 TypeScript errors

---

## 14. What Makes MediPulse Different

| Traditional ERP / WMS | MediPulse |
|---|---|
| Tracks what happened | Predicts what's about to happen |
| Static reorder points | Dynamic seasonal adjustments |
| No supplier intelligence | Multi-supplier price comparison built-in |
| Complex + expensive | SaaS, pharmacy-native, simple UX |
| No AI layer | Plain-language AI explanations for every decision |

> **The pitch:** "We don't just track your inventory — we tell you what to buy, from whom, and why."

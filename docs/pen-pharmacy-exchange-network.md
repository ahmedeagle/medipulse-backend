# Pharmacy Exchange Network (PEN) — Full Build Documentation

> **Project:** MediPulse P2P Smart Trading Network  
> **Codename:** PEN — Pharmacy Exchange Network  
> **Status:** All 5 phases complete, both repos compile clean (0 TS errors)  
> **Goal:** Beat competitor Aumet by turning every pharmacy into a buyer, seller, emergency source, and smart inventory node simultaneously

---

## Table of Contents

1. [What We Built vs Aumet](#what-we-built-vs-aumet)
2. [Architecture Overview](#architecture-overview)
3. [Backend — All Modules](#backend--all-modules)
4. [Frontend — All Screens](#frontend--all-screens)
5. [Database Migrations](#database-migrations)
6. [Performance & Scale Decisions](#performance--scale-decisions)
7. [Phase-by-Phase Breakdown](#phase-by-phase-breakdown)
8. [API Reference](#api-reference)
9. [Key Files](#key-files)
10. [How to Run Migrations](#how-to-run-migrations)

---

## What We Built vs Aumet

| Feature | Aumet | PEN |
|---|---|---|
| Product validation errors shown | **1** (unlinked only) | **9**, all inline-fixable without leaving the page |
| Listing types | 1 | 3 — Normal / 🔥 Clearance / ⚡ Emergency |
| Search result ranking | Basic (insertion order) | 6-factor composite score computed in SQL |
| Urgent medicine finder | ❌ | ✓ Live countdown timer, distance-first sort |
| Reservation window | ❌ | ✓ 60-minute window, auto-cancelled by cron if missed |
| Dead stock / expiry recovery | ❌ | ✓ Expiry Protection Engine (180/90/60/30d) |
| AI procurement intelligence | ❌ | ✓ Finds P2P savings vs supplier catalog |
| Pharmacy auto-matching | ❌ | ✓ Nightly excess/shortage pairing across city |
| Trust levels | Basic rating | Bronze / Silver / Gold / Platinum (sample-size gated) |
| Legal compliance | One-time | Re-shown every 90 days automatically |
| Transfer invoices | ❌ | ✓ Auto-generated with Redis-sequenced invoice numbers |
| Dispute center | Basic | Full audit trail with evidence URLs |
| Auto-discount cron | ❌ | ✓ 90d→5%, 60d→10%, 30d→15% (opt-in per listing) |

---

## Architecture Overview

```
medipulse-backend (NestJS)
├── p2p-seller/          ← Seller profiles + reliability scoring
├── p2p-listing/         ← Listings + ListingRulesEngine (9 rules)
├── p2p-orders/          ← Order state machine + invoices + disputes
└── p2p-marketplace/     ← Smart search + intelligence + matching

medipulse-frontend (React + Vite)
└── src/pages/pharmacy/P2PPage.tsx   ← Single-page hub with 5 tabs
    ├── Marketplace   (search + smart ranking + order modal)
    ├── Sell          (my listings + AddListingForm + 9-rule panel)
    ├── Orders        (buyer + seller views + countdown timer)
    ├── AI Insights   (procurement opportunities + market intelligence)
    └── Seller Profile (3-step wizard + expiry alerts panel)
```

**Tech stack used:**
- NestJS + TypeORM + PostgreSQL (raw `getRawMany()` for ranking queries)
- Redis (invoice sequence counter via `INCR`)
- BullMQ (existing queue infrastructure)
- `@nestjs/schedule` `@Cron` (reservation expiry + reliability scoring + auto-discount + matching)
- React 18 + TanStack Query v5 + Zustand + Tailwind CSS + i18next (AR/EN RTL)

---

## Backend — All Modules

### Module 1: `p2p-seller` (`src/p2p-seller/`)

**Entities:**
- `seller_profiles` — Legal name, GPS, city, region, delivery zones (JSONB), verification status, `lastLegalAckAt`
- `seller_reliability_scores` — Acceptance rate, avg response minutes, fulfillment rate, overall score 0–100, trust level

**Trust level thresholds:**
```
platinum: overallScore ≥ 90 AND sampleSize ≥ 50
gold:     overallScore ≥ 75 AND sampleSize ≥ 20
silver:   overallScore ≥ 55 AND sampleSize ≥ 5
bronze:   at least 1 completed order
```

**Services:**
- `SellerProfileService` — CRUD + legal ack endpoint
- `SellerReliabilityService` — `@Cron('0 3 * * *')` daily recalculation:
  ```
  responseSpeed = max(0, 1 - avgResponseMinutes / 1440)
  overallScore  = acceptanceRate×50 + responseSpeed×30 + fulfillmentRate×20
  ```
- `ExpiryProtectionService` — Queries inventory expiring within 180 days, returns urgency-tagged alerts

**Endpoints:**
```
PUT   /p2p/seller/profile          PHARMACY_ADMIN — upsert profile
GET   /p2p/seller/profile          PHARMACY_ADMIN — own profile
POST  /p2p/seller/profile/legal-ack PHARMACY_ADMIN — record 90-day compliance
GET   /p2p/seller/expiry-alerts    PHARMACY_ADMIN — near-expiry inventory with suggested action
GET   /p2p/admin/sellers           SYSTEM_ADMIN   — paginated seller list
PATCH /p2p/admin/sellers/:id/verify SYSTEM_ADMIN
PATCH /p2p/admin/sellers/:id/reject SYSTEM_ADMIN   body: { reason }
```

---

### Module 2: `p2p-listing` (`src/p2p-listing/`)

**Entity: `p2p_listings`**
- `sellerTenantId`, `inventoryItemId`, `productId` (denormalized)
- `price`, `quantity`, `minOrderQty`, `expiryDate`
- `status`: active / paused / sold_out / expired
- `listingType`: normal / clearance / emergency
- `offerType`: none / discount / bonus, `discountPct`, `bonusQty`
- `autoUpdateDiscount` — triggers daily cron tiering

**`ListingRulesEngine` — all 9 validation codes:**

| Code | Severity | Trigger |
|---|---|---|
| `UNLINKED_PRODUCT` | **blocking** | `linkStatus !== 'linked'` |
| `EXPIRED` | **blocking** | `expiryDate ≤ today` |
| `ZERO_STOCK` | **blocking** | `quantity ≤ 0` |
| `BELOW_MIN_QTY` | **blocking** | `listing.quantity < minOrderQty` |
| `NEAR_EXPIRY_30` | warning | days to expiry ≤ 30 |
| `NEAR_EXPIRY_60` | warning | days to expiry ≤ 60 |
| `NEAR_EXPIRY_90` | warning | days to expiry ≤ 90 |
| `PRICE_ANOMALY` | warning | `price < costPrice` |
| `DUPLICATE_LISTING` | warning | active listing exists for same inventoryItemId |

Blocking issues → `BadRequestException({ issues })` — publish blocked.  
Warnings → listing saved, issues returned in response for user acknowledgement.

**Auto-discount cron** `@Cron('15 3 * * *')` — 4 bulk SQL UPDATE statements (no rows loaded to TypeScript):
- `expiryDate > today AND ≤ today+30d` → 15% off, type = clearance
- `expiryDate > today+30 AND ≤ today+60d` → 10% off
- `expiryDate > today+60 AND ≤ today+90d` → 5% off
- `expiryDate ≤ today` → status = expired

**Endpoints:**
```
POST   /p2p/listings           PHARMACY_ADMIN — create
GET    /p2p/listings           PHARMACY_ADMIN — own listings paginated
GET    /p2p/listings/:id       PHARMACY_ADMIN — single + issues
PATCH  /p2p/listings/:id       PHARMACY_ADMIN — update
PATCH  /p2p/listings/:id/pause
PATCH  /p2p/listings/:id/resume
DELETE /p2p/listings/:id       soft delete → status: expired
POST   /p2p/listings/validate  PHARMACY_ADMIN — live validate, no save (for debounce)
```

---

### Module 3: `p2p-orders` (`src/p2p-orders/`)

**Entities:**
- `p2p_orders` — buyer/seller, listingId, requestedQty, agreedPrice (price snapshot), status, `reservationExpiresAt`, notes, rejectionReason
- `p2p_transfer_invoices` — auto-generated on accept; Redis-sequenced invoice numbers `P2P-YYYY-MM-NNNNNN`
- `p2p_disputes` — type, description, evidenceUrls JSONB, status, adminNotes

**State machine:**
```
pending → accepted → completed (buyer confirms receipt)
        → rejected  (seller)
        → cancelled (buyer or seller while pending; buyer only while accepted)
accepted → cancelled (buyer only, before completion)
```

**`accept()` method:** SERIALIZABLE transaction with pessimistic write lock on both `InventoryItem` and `P2pListing` — prevents over-selling. Sets `reservationExpiresAt = now + 60 minutes`.

**`cancel()` method:** READ COMMITTED transaction with pessimistic write lock — prevents race with reservation cron when restoring listing quantity.

**`P2pReservationCron`** `@Cron('*/5 * * * *')`:
- Finds accepted orders where `reservationExpiresAt < now`
- Restores `listing.quantity += order.requestedQty`, sets `listing.status = active`
- Cancels the order
- Processes in batches of 100

**Endpoints:**
```
POST  /p2p/orders                PHARMACY_ADMIN — buyer creates
GET   /p2p/orders                PHARMACY_ADMIN — buyer or seller view (paginated)
GET   /p2p/orders/:id
PATCH /p2p/orders/:id/accept     seller
PATCH /p2p/orders/:id/reject     seller  body: { reason }
PATCH /p2p/orders/:id/complete   buyer confirms receipt
PATCH /p2p/orders/:id/cancel
GET   /p2p/orders/:id/invoice
POST  /p2p/orders/:id/dispute    buyer opens dispute
GET   /p2p/orders/:id/dispute
```

---

### Module 4: `p2p-marketplace` (`src/p2p-marketplace/`)

**Smart ranking formula** — computed entirely in SQL, never in TypeScript:
```sql
rankScore =
  LEAST(1, quantity/50) × 0.25          -- availability
  + GREATEST(0, 1 - distKm/maxRadius) × 0.25  -- distance
  + (1 - price/maxPrice) × 0.20         -- price competitiveness
  + (overallScore/100) × 0.15           -- seller reliability
  + LEAST(1, daysToExpiry/180) × 0.10   -- shelf life
  + 0.5 × 0.05                          -- delivery (placeholder)
```

Distance uses inline Haversine SQL — GPS stored as `"lat,lng"` string:
```sql
6371 * acos(LEAST(1, GREATEST(-1,
  cos(radians($lat)) * cos(radians(split_part(gpsLocation,',',1)::float))
  * cos(radians(split_part(gpsLocation,',',2)::float) - radians($lng))
  + sin(radians($lat)) * sin(radians(split_part(gpsLocation,',',1)::float))
)))
```

**Services:**
- `P2pMarketplaceService` — `search()` + `searchUrgent()` + `getListing()`
- `P2pMarketIntelligenceService` — 4 parallel SQL aggregates (seller/listing counts, avg prices, top traded, city density)
- `P2pSmartProcurementService` — LATERAL JOIN: items below `minThreshold` where P2P price < supplier price × 0.95
- `PharmacyMatchingService` — nightly `@Cron('0 2 * * *')` LATERAL JOIN finding excess/shortage city pairs → creates `INTER_BRANCH_TRADE` AI recommendations

**Endpoints:**
```
GET /p2p/marketplace/search                    PHARMACY_ADMIN — smart-ranked search
GET /p2p/marketplace/urgent                    PHARMACY_ADMIN — distance-first, emergency+near-expiry
GET /p2p/marketplace/listings/:id              PHARMACY_ADMIN
GET /p2p/marketplace/intelligence              PHARMACY_ADMIN — market stats
GET /p2p/marketplace/procurement-opportunities PHARMACY_ADMIN — P2P savings vs supplier
GET /p2p/admin/exchange-suggestions            SYSTEM_ADMIN   — excess/shortage matches
```

---

## Frontend — All Screens

**Entry point:** `src/pages/pharmacy/P2PPage.tsx` — single file, ~1400 lines

**Navigation:** `TopNav.tsx` — `P2PExchangeLink` component with `NEW` badge, shown for `pharmacy_admin` role only. Highlights emerald when active.

### Tab 1 — Marketplace
- Quick-filter chips: All / 🔥 Clearance / ⚡ Urgent
- Urgent mode: switches query to `/marketplace/urgent`, shows red banner
- Search: medicine name / city filter (hidden in urgent mode)
- Results: `MarketplaceCard` grid — type badge strip, price, seller name, trust badge, distance, expiry countdown, "Order Now" button
- Order modal: seller info, price/qty/min breakdown, quantity input, notes, total, send request
- Pagination: previous/next with count display

### Tab 2 — Sell
- "New Listing" button (guarded by legal ack check)
- `AddListingForm`: inventory item ID, price, qty, min order, expiry date, listing type, discount %, auto-discount toggle
- `ProductRulesPanel`: live debounce validation (600ms), shows all 9 issue types
  - Blocking issues: red background, publish button disabled
  - Warnings: amber background, inline fix buttons (`تعديل`) — click to expand input, re-validates live
  - All issues clear → green "Ready to publish" state
- My listings grid: `MyListingCard` with status badge, pause/resume toggle

### Tab 3 — Orders
- Role filter: All / Buying / Selling
- `OrderCard` per order:
  - Status badge, qty × price, date
  - **Seller actions** (pending): Accept / Reject (with reason input) / Cancel
  - **Buyer actions** (accepted): countdown timer + "Confirm Receipt"
  - **Countdown timer**: amber (>10min) → orange (<10min) → red (expired) — updates every second
  - Rejection reason shown on rejected cards

### Tab 4 — AI Insights (Phase 4)
- **Procurement Opportunities section:**
  - `ProcurementCard` per item: product ID, P2P price vs supplier price crossed out, savings % badge, stock level (current/threshold in red), seller name/city/distance, listing type badge, "Order" button → switches to Marketplace tab
  - Empty state with helpful message
- **Market Intelligence section:**
  - 4 stat cards: Active Sellers / Active Listings / Products Listed / Active Cities
  - Top 5 traded products (30d): rank number, product ID, order count, unit volume
  - City density: horizontal bar chart per city

### Tab 5 — Seller Profile
- 3-step wizard: Legal Info → Location & Delivery → Settings
- Step indicators with checkmark on completed steps
- Verification status banner (green/amber/red)
- **Expiry Alerts Panel** below wizard:
  - Critical (≤30d) — red row
  - High (≤60d) — orange row
  - Medium (≤90d) — amber row
  - Low (≤180d) — blue row
  - Each row: urgency dot, product ID, qty + days left, suggested discount %
  - "Already Listed" badge if item already on PEN
  - "List Now" / "Increase Discount" / "List as Clearance" button → switches to Sell tab
  - Empty state: green shield "Your inventory is safe"

### Legal Declaration Modal
- Shown on first publish and every 90 days (`lastLegalAckAt` check)
- Checkbox required before confirm activates
- On confirm: `POST /p2p/seller/profile/legal-ack` → proceeds with pending action

---

## Database Migrations

All in `src/migrations/` — run with `npm run migration:run`:

| File | Description |
|---|---|
| `1780700500000-AddP2pSellerProfiles.ts` | `seller_profiles`, `seller_reliability_scores` tables |
| `1780700600000-AddP2pListings.ts` | `p2p_listings` table + indexes |
| `1780700700000-AddP2pOrders.ts` | `p2p_orders`, `p2p_transfer_invoices`, `p2p_disputes` tables |
| `1780700800000-ExtendP2pEnums.ts` | `INTER_BRANCH_TRADE`, `P2P_LISTING_SUGGESTION`, `SMART_PROCUREMENT` recommendation types |
| `1780700900000-AddP2pPerformanceIndexes.ts` | 6 partial/composite indexes for scale |
| `1780701000000-AddAutoDiscountIndex.ts` | 3 additional indexes (auto-discount cron, product-active, seller-all) |

**Key indexes:**
```sql
-- Primary marketplace scan (partial — only active rows with stock)
idx_p2p_listings_active_marketplace ON p2p_listings (sellerTenantId, price, quantity, listingType)
  WHERE status = 'active' AND quantity > 0

-- Auto-discount cron (partial — only rows the cron needs to touch)
idx_p2p_listings_auto_discount ON p2p_listings (expiryDate ASC)
  WHERE autoUpdateDiscount = true AND status = 'active' AND expiryDate IS NOT NULL

-- Smart procurement LATERAL join
idx_p2p_listings_product_active ON p2p_listings (productId, price ASC)
  WHERE status = 'active' AND quantity > 0

-- Buyer order history
idx_p2p_orders_buyer_created ON p2p_orders (buyerTenantId, createdAt DESC)

-- Seller full history
idx_p2p_orders_seller_all ON p2p_orders (sellerTenantId, createdAt DESC)

-- Seller profile join (partial — only verified+visible)
idx_seller_profiles_visible_verified ON seller_profiles (pharmacyTenantId, city)
  WHERE verificationStatus = 'verified' AND isVisible = true
```

---

## Performance & Scale Decisions

### Problem 1 — Marketplace ranking at 100k+ listings
**Old:** `qb.getMany()` loaded ALL listings to TypeScript → sorted in JS → sliced  
**New:** Composite rank score as raw SQL expression → `ORDER BY rank_expr DESC LIMIT/OFFSET` fully in DB. `getRawMany()` returns only the requested page.

### Problem 2 — Auto-discount cron at scale
**Old:** `repo.find({ where: { autoUpdateDiscount: true } })` → loop of N individual `UPDATE` calls  
**New:** 4 bulk SQL `UPDATE … WHERE expiryDate BETWEEN $1 AND $2` — zero rows loaded to TypeScript, entire operation in 4 DB round-trips regardless of table size.

### Problem 3 — Reservation cancel race condition
**Old:** `findOne` order → `findOne` listing → `update` listing → `update` order — no transaction  
**New:** Single READ COMMITTED transaction with `pessimistic_write` lock on both rows. Prevents the reservation cron and buyer cancel from both restoring quantity simultaneously.

### Problem 4 — Orders `findAll` with role='both' at scale
**Old:** `WHERE buyerTenantId = $1 OR sellerTenantId = $1` — OR on two indexed columns → seq scan  
**New:** UNION query so PostgreSQL uses each index independently for its branch, then merges.

### Problem 5 — `syncQuantityFromInventory` loop
**Old:** Fetch all active listings for item → loop N individual UPDATE calls  
**New:** Single `UPDATE p2p_listings SET quantity = LEAST(quantity, $1) WHERE inventoryItemId = $2 AND status = 'active'`

### Frontend performance
- All 22 page components are `React.lazy()` — code-split per route
- `Suspense` at App level (full-page spinner on first load) + inner Suspense in AppLayout (spinner on tab switch only)
- `QueryClient`: `staleTime: 60s`, `gcTime: 10min`, `networkMode: 'offlineFirst'`, `refetchOnWindowFocus: false`
- Urgent mode marketplace: `staleTime: 30s` (more aggressive refresh for time-sensitive data)

---

## Phase-by-Phase Breakdown

### Phase 1 — Marketplace MVP (matches + beats Aumet)
- All 4 backend modules created
- `ListingRulesEngine` with 9 validation codes
- Smart-ranked marketplace search (SQL)
- Full order flow with SERIALIZABLE transaction on accept
- Transfer invoice auto-generation with Redis counter
- Legal declaration modal (90-day cycle)
- `ProductRulesPanel` with inline fix-in-place (our main differentiator vs Aumet)

### Phase 2 — Urgent Medicine Finder
- `GET /p2p/marketplace/urgent` — distance-first, emergency + near-expiry-30d
- `reservationExpiresAt` set to `now + 60min` on seller accept
- `P2pReservationCron` — `@Cron('*/5 * * * *')`, batch 100, restores quantity on expiry
- Frontend: Urgent chip + banner + live countdown timer on accepted OrderCards

### Phase 3 — Expiry Protection Engine
- `ExpiryProtectionService.getAlertsForSeller()` — horizon 180 days, urgency tiering, already-listed check
- `GET /p2p/seller/expiry-alerts`
- Frontend: `ExpiryAlertsPanel` in Seller Profile tab

### Phase 4 — AI Procurement Intelligence
- `P2pMarketIntelligenceService` — 4 parallel aggregate SQL queries, city density
- `P2pSmartProcurementService` — LATERAL JOIN comparing P2P vs supplier catalog prices
- Frontend: AI Insights tab with procurement opportunity cards + market intelligence dashboard

### Phase 5 — Pharmacy Exchange Automation
- `PharmacyMatchingService` — nightly `@Cron('0 2 * * *')` finds excess/shortage pairs in same city
- Creates `INTER_BRANCH_TRADE` AI recommendations for both pharmacies
- `GET /p2p/admin/exchange-suggestions` — admin monitoring endpoint

---

## API Reference

### Full endpoint list

```
# Seller profile
PUT   /p2p/seller/profile
GET   /p2p/seller/profile
POST  /p2p/seller/profile/legal-ack
GET   /p2p/seller/expiry-alerts

# Admin seller management
GET   /p2p/admin/sellers
PATCH /p2p/admin/sellers/:id/verify
PATCH /p2p/admin/sellers/:id/reject

# Listings
POST   /p2p/listings
GET    /p2p/listings
GET    /p2p/listings/:id
PATCH  /p2p/listings/:id
PATCH  /p2p/listings/:id/pause
PATCH  /p2p/listings/:id/resume
DELETE /p2p/listings/:id
POST   /p2p/listings/validate

# Orders
POST  /p2p/orders
GET   /p2p/orders              ?role=buyer|seller|both
GET   /p2p/orders/:id
PATCH /p2p/orders/:id/accept
PATCH /p2p/orders/:id/reject   body: { reason }
PATCH /p2p/orders/:id/complete
PATCH /p2p/orders/:id/cancel
GET   /p2p/orders/:id/invoice
POST  /p2p/orders/:id/dispute  body: { type, description, evidenceUrls? }
GET   /p2p/orders/:id/dispute

# Marketplace
GET /p2p/marketplace/search                    ?q&city&radiusKm&buyerGps&minPrice&maxPrice&listingType&minSellerScore&limit&offset
GET /p2p/marketplace/urgent                    ?buyerGps&limit&offset
GET /p2p/marketplace/listings/:id
GET /p2p/marketplace/intelligence              ?city
GET /p2p/marketplace/procurement-opportunities ?buyerGps&limit

# Admin
GET /p2p/admin/exchange-suggestions            ?limit
```

---

## Key Files

### Backend (`medipulse-backend/src/`)

```
p2p-seller/
├── entities/
│   ├── seller-profile.entity.ts
│   └── seller-reliability-score.entity.ts
├── seller-profile.service.ts
├── seller-reliability.service.ts
├── expiry-protection.service.ts
├── p2p-seller.controller.ts
└── p2p-seller.module.ts

p2p-listing/
├── entities/p2p-listing.entity.ts
├── listing-rules.engine.ts          ← 9-rule pure class
├── p2p-listing.service.ts
├── p2p-listing.controller.ts
└── p2p-listing.module.ts

p2p-orders/
├── entities/
│   ├── p2p-order.entity.ts
│   ├── p2p-transfer-invoice.entity.ts
│   └── p2p-dispute.entity.ts
├── p2p-orders.service.ts
├── p2p-reservation.cron.ts          ← @Cron('*/5 * * * *')
├── p2p-orders.controller.ts
└── p2p-orders.module.ts

p2p-marketplace/
├── p2p-marketplace.service.ts        ← SQL-ranked search
├── p2p-market-intelligence.service.ts
├── p2p-smart-procurement.service.ts
├── pharmacy-matching.service.ts      ← @Cron('0 2 * * *')
├── p2p-marketplace.controller.ts
└── p2p-marketplace.module.ts

migrations/
├── 1780700500000-AddP2pSellerProfiles.ts
├── 1780700600000-AddP2pListings.ts
├── 1780700700000-AddP2pOrders.ts
├── 1780700800000-ExtendP2pEnums.ts
├── 1780700900000-AddP2pPerformanceIndexes.ts
└── 1780701000000-AddAutoDiscountIndex.ts
```

### Frontend (`medipulse-frontend/src/`)

```
pages/pharmacy/
└── P2PPage.tsx              ← ~1400 lines, all 5 tabs

components/p2p/
├── ProductRulesPanel.tsx    ← 9-rule validation panel with inline fix
└── LegalDeclarationModal.tsx

components/layout/
└── TopNav.tsx               ← P2PExchangeLink with NEW badge

api/
└── p2p.api.ts               ← All API calls

types/
└── p2p.ts                   ← All TypeScript types

i18n/locales/
├── ar.json                  ← p2p.* namespace (~80 Arabic keys)
└── en.json                  ← p2p.* namespace (~80 English keys)
```

---

## How to Run Migrations

```bash
# From medipulse-backend root
npm run migration:run

# Or with TypeORM CLI directly
npx typeorm migration:run -d src/config/typeorm.config.ts
```

All 6 P2P migrations will run in timestamp order. They use `CREATE INDEX CONCURRENTLY` so they are safe to run on a live database without full table locks.

---

*Documentation generated: June 2026*  
*Built by: Ahmed Emam + Claude Code*

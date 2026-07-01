# "أحتاج دواء" — Drug Need Request (On-Demand Sourcing + Demand Capture)

> A pharmacy-initiated "I need this drug now" action, **unified with the existing
> Decision Engine** (`ProcurementOrchestrator`). It instantly sources the best deal
> across distributors + nearby pharmacies, and durably records the *demand* so it can
> power notify-when-available and the future Shortage Radar.

---

## 1. Why this exists

P2P historically captured only **supply** — what pharmacies offer for sale. The missing
half was **demand**: a pharmacy that needs a drug *right now* had no first-class way to
say so. "أحتاج دواء" closes that gap with one clear, visible action — and reuses the same
engine that already powers AI purchase drafts, so there is **no parallel/fragmented flow**.

Two outcomes from one click:
1. **Instant sourcing** — best-priced split across distributors + nearby pharmacies.
2. **Demand signal** — a durable record that fuels notify-when-available and the
   (roadmap) regional Shortage Radar.

---

## 2. How a user initiates it (UI)

- A **prominent primary button** `أحتاج دواء` / `I Need a Drug` (emerald→teal gradient,
  pill icon) lives in the **top navigation bar**, visible on every pharmacy page and on
  all screen sizes — `medipulse-frontend/src/components/layout/TopNav.tsx`
  (rendered via `NeedDrugButton`, before the cart button, for `pharmacy_admin`).
- Clicking it opens a modal with two tabs:
  - **طلب جديد / New request** — type the drug name (or barcode), quantity, and urgency
    (عادي / عاجل / طارئ). Submit → the result panel shows the best sources (distributor or
    nearby pharmacy), best unit price, and savings vs the pharmacy's historical average.
    If nothing is available, the request is still saved and the pharmacy is told it will
    be alerted.
  - **طلباتي / My requests** — the pharmacy's needs with status badges (قيد البحث / تم
    الإيجاد / ...) and a cancel action.

Component: `medipulse-frontend/src/components/needs/NeedDrugButton.tsx`
API client: `medipulse-frontend/src/api/needs.api.ts`

---

## 3. Backend

All inside `ProcurementModule` so it inherits the orchestrator's DI graph.

| Concern    | File |
|------------|------|
| Entity     | `medipulse-backend/src/procurement/entities/drug-need-request.entity.ts` |
| DTO        | `medipulse-backend/src/procurement/dto/create-drug-need.dto.ts` |
| Service    | `medipulse-backend/src/procurement/drug-need.service.ts` |
| Controller | `medipulse-backend/src/procurement/drug-need.controller.ts` |
| Migration  | `medipulse-backend/src/migrations/1790700000000-AddDrugNeedRequests.ts` |
| Re-source cron | `medipulse-backend/src/procurement/need-resource.cron.ts` |
| Wiring (HTTP)  | `medipulse-backend/src/procurement/procurement.module.ts` |
| Wiring (worker)| `medipulse-backend/src/procurement/procurement-worker.module.ts` |

### Table `drug_need_requests`
`id`, `pharmacyTenantId`, `productId` (nullable), `productName`, `requestedQty`,
`urgency` (normal/urgent/critical), `status` (open/sourced/fulfilled/cancelled/expired),
`region`, `sourceOptionsCount`, `resultSnapshot` (jsonb), `expiresAt`, `createdAt`,
`updatedAt`. Indexes: `(pharmacyTenantId, status)`, `(productId, status)`.

### Flow (`DrugNeedService.createNeed`)
1. Resolve `productId` — from `dto.productId`, else catalog lookup (exact barcode, then
   ILIKE on `name` / `nameAr` / `genericName`).
2. If a product resolves → call
   `ProcurementOrchestrator.generatePlan(tenantId, productId, qty, { triggerEvent: 'manual' })`.
3. Build a compact `resultSnapshot` (splits, totalCost, bestUnitPrice, savedVsHistoricalAvg,
   delayReason). `status = 'sourced'` when splits exist, else `'open'`.
4. Sourcing failures never drop the demand signal — the row is still saved as `open`.
5. `expiresAt = now + 7 days`.

### Endpoints (`@Controller('needs')`, `PHARMACY_ADMIN`, JWT + roles guards)
- `POST /needs` — create + source. Throttled (20/min).
- `GET  /needs?status=` — list this pharmacy's needs (newest first).
- `PATCH /needs/:id/cancel` — cancel an open need.

---

## 4. Unified with the Decision Engine

The need does **not** re-implement sourcing. It calls the exact same
`ProcurementOrchestrator.generatePlan` used by AI purchase drafts and the cart — so the
splits, reliability scoring, financial guardrails, savings (`explainability.financialImpact
.savedVsHistoricalAvg`) and delay advice are all consistent across the product.

---

## 5. Notifications

Every outcome is also written to the in-app notification bell via the existing
`NotificationService` (no new plumbing). All use `resourceRef=needId=<id>` and a dedupe
window to avoid spam.

| When | Type | Message (AR) |
|------|------|--------------|
| Need created → sourced now | `p2p_opportunity` | «وجدنا مصدر لـ X — N مصادر بأفضل سعر … ووفّرنا لك ~Y ج.م» |
| Need created → no source yet | `system` | «سجّلنا طلبك — هنبحث وننبّهك أول ما يتوفّر» |
| **Notify-when-available** (cron flips open→sourced) | `p2p_opportunity` | «توفّر الدواء X — بقى متاح …» |

Source: `DrugNeedService.notifyOutcome` (create time) and
`NeedResourceCronService.notifyAvailable` (sweep).

---

## 6. Notify-when-available sweep (cron)

`NeedResourceCronService` (worker-only, `@Cron('0 */4 * * *')` — every 4 hours):
1. **Expire** `open` needs past `expiresAt` → `status = 'expired'`.
2. **Re-source** up to 100 oldest `open` needs (with a resolved `productId`) through the
   same `ProcurementOrchestrator.generatePlan`. The first time splits appear, the need
   flips `open → sourced`, the snapshot is refreshed, and the pharmacy is notified.
3. Guarded by a distributed Redis lock (`CronLockService.acquire('need_resource_sweep')`)
   so multiple worker replicas never double-sweep. Per-need failures are isolated and
   logged — they never abort the batch.

Registered in `ProcurementWorkerModule` (imports `CronLockModule` + `NotificationsModule`
+ `forFeature([DrugNeedRequest])`).

---

## 7. Roadmap (clearly NOT shipped yet)

- **Shortage Radar** — aggregate `COUNT(distinct pharmacy)` of `open` needs per product
  per region to surface market-wide shortages. Product-level aggregation only; an
  individual pharmacy's need is never exposed to other tenants. Intentionally hidden in
  the UI until real data exists — no fake widgets, no confusion between live vs planned.
- **Demand broadcast** — notify nearby pharmacies with surplus (`p2p_pool_opportunity`)
  so they can fulfil an open need. Belongs with the Shortage Radar matching logic.

---

## 8. Verification

- Backend `npx tsc --noEmit -p tsconfig.json` → exit 0.
- Frontend `npx tsc --noEmit` → exit 0.
- Run migration `1790700000000-AddDrugNeedRequests` (auto-discovered via `src/migrations/*.ts`).
- `POST /needs` with a known product → `status: 'sourced'`, populated `resultSnapshot.splits`, bell notification.
- `POST /needs` with an unknown name → `status: 'open'`, `resultSnapshot: null`, “will alert” notification.
- Cron: an `open` need becomes sourceable → next sweep flips it to `sourced` and notifies the pharmacy.
- UI: button visible across pharmacy pages; submit renders sources; «طلباتي» lists + cancels.
- Website: new `أحتاج دواء` capability card live in the Capabilities grid (AR + EN).

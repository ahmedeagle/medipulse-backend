import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { DemandForecast } from '../forecasting/entities/demand-forecast.entity';
import { ProcurementSchedule } from '../forecasting/entities/procurement-schedule.entity';
import { RecommendationType } from '../common/enums/recommendation-type.enum';
import { HijriCalendar, DemandSignal as HijriDemandSignal } from '../common/utils/hijri-calendar';

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type DemandTrend = 'increasing' | 'stable' | 'decreasing';

export interface RawRecommendation {
  type: RecommendationType;
  productId: string | null;
  riskLevel: RiskLevel;
  payload: Record<string, any>;
}

export interface P2pListingSlim {
  id: string;
  sellerTenantId: string;
  productId: string;
  price: number;
  quantity: number;
  minOrderQty: number;
  expiryDate: Date | null;
  listingType: string;
  discountPct: number | null;
}

export interface RulesEngineContext {
  /** Map supplierTenantId → score (optional) */
  supplierScores?: Map<string, SupplierReliabilityScore>;
  /** Map productId → last 8 weekly snapshots (optional) */
  consumptionData?: Map<string, ConsumptionSnapshot[]>;
  /** Map productId → 14-day demand forecast (optional) */
  forecastData?: Map<string, DemandForecast>;
  /** Map productId → EOQ procurement schedule (optional) */
  scheduleData?: Map<string, ProcurementSchedule>;
  /** Region for regional demand signals */
  region?: string;
  /** Active P2P listings from other pharmacies — used for SMART_PROCUREMENT rule */
  p2pListings?: P2pListingSlim[];
}

// ─── Seasonality Engine — Hijri calendar-based (replaces hardcoded SEASONAL_RULES) ─

/**
 * SeasonalityEngine now uses the Hijri calendar instead of Gregorian month ranges.
 *
 * Old approach (REMOVED):
 *   winter = Nov-Feb → +25% respiratory (wrong for Saudi Arabia)
 *   summer = Jun-Aug → +30% hydration (too simple, ignored Hajj)
 *
 * New approach:
 *   Hajj season (Dhu al-Hijja) → +250% antibiotics, +250% antidiarrheals
 *   Ramadan (month 9)          → +80% antacids, -20% antibiotics
 *   School return (Sep 1-21)   → +120% pediatric antibiotics
 *   Everything else            → data-driven via RegionalSignalComputerService
 *
 * This is the fix the investor requested. The old model was a liability.
 */
export class SeasonalityEngine {
  private readonly today: Date;

  constructor(date?: Date) {
    this.today = date ?? new Date();
  }

  getSignal(category: string): HijriDemandSignal {
    return HijriCalendar.getCategoryMultiplier(this.today, category);
  }

  /** Returns multiplier - 1.0 (i.e. 0.5 means +50% above baseline) for backward compat */
  getMultiplierDelta(category: string): number {
    const signal = this.getSignal(category);
    return signal.multiplier - 1.0;
  }

  getEventLabel(): string {
    const event = HijriCalendar.getActiveEvent(this.today);
    return event?.arabicName ?? 'No active event';
  }
}

// ─── Demand Engine ────────────────────────────────────────────────────────────

export interface DemandSignal {
  avg30: number;
  avg90: number;
  trend: DemandTrend;
  dailyUsage: number;
}

export class DemandEngine {
  getSignal(
    productId: string,
    orderHistory: { productId: string; quantity: number; createdAt: Date }[],
  ): DemandSignal {
    const now = Date.now();
    const DAY = 86_400_000;
    const items = orderHistory.filter((o) => o.productId === productId);
    const last30 = items.filter((o) => now - o.createdAt.getTime() <= 30 * DAY);
    const sum30 = last30.reduce((s, o) => s + o.quantity, 0);
    const sum90 = items.reduce((s, o) => s + o.quantity, 0);
    const avg30 = sum30 / 30;
    const avg90 = sum90 / 90;
    let trend: DemandTrend = 'stable';
    if (avg90 > 0) {
      if (avg30 > avg90 * 1.1) trend = 'increasing';
      else if (avg30 < avg90 * 0.9) trend = 'decreasing';
    }
    const dailyUsage = avg30 > 0 ? avg30 : avg90;
    return { avg30, avg90, trend, dailyUsage };
  }
}

// ─── Risk Engine ──────────────────────────────────────────────────────────────

export class RiskEngine {
  assess(stockDays: number, expectedNeedDays: number): RiskLevel {
    if (stockDays < expectedNeedDays) return 'HIGH';
    if (stockDays < expectedNeedDays * 1.5) return 'MEDIUM';
    return 'LOW';
  }

  stockDays(currentQuantity: number, dailyUsage: number): number {
    if (dailyUsage <= 0) return 999;
    return Math.floor(currentQuantity / dailyUsage);
  }

  suggestedReorderQty(dailyUsage: number, currentQuantity: number, leadDays = 14): number {
    const safetyBuffer = Math.ceil(dailyUsage * 7);
    const needed = Math.ceil(dailyUsage * leadDays);
    return Math.max(0, needed - currentQuantity + safetyBuffer);
  }
}

// ─── Main Rules Engine ────────────────────────────────────────────────────────

export class RulesEngine {
  private readonly demand = new DemandEngine();
  private readonly risk = new RiskEngine();

  generateRecommendations(
    inventoryItems: InventoryItem[],
    supplierCatalog: SupplierCatalogItem[],
    orderHistory: { productId: string; quantity: number; createdAt: Date }[] = [],
    ctx: RulesEngineContext = {},
  ): RawRecommendation[] {
    const recs: RawRecommendation[] = [];
    const today = new Date();
    const {
      supplierScores  = new Map(),
      consumptionData = new Map(),
      forecastData    = new Map(),
      scheduleData    = new Map(),
    } = ctx;

    // ── Insufficient data check ───────────────────────────────────────────────
    // If fewer than 4 weeks of order history, demand signals are zero and risk
    // assessments will be wrong (stockDays = 999 → LOW risk for everything).
    // Instead of generating misleading LOW-risk recommendations, return a single
    // INSUFFICIENT_DATA notification so the user knows what's happening.
    const historyDays = orderHistory.length > 0
      ? Math.min(90, Math.ceil((Date.now() - Math.min(...orderHistory.map(o => o.createdAt.getTime()))) / 86_400_000))
      : 0;

    const hasInsufficientHistory = historyDays < 28; // less than 4 weeks

    if (hasInsufficientHistory && inventoryItems.filter(i => i.quantity <= i.minThreshold).length > 0) {
      const lowStockCount = inventoryItems.filter(i => i.quantity <= i.minThreshold).length;
      recs.push({
        type: RecommendationType.INSUFFICIENT_DATA,
        productId: null,
        riskLevel: 'MEDIUM',
        payload: {
          historyDays,
          lowStockCount,
          message: `${lowStockCount} product${lowStockCount !== 1 ? 's' : ''} below threshold detected. Order at least a few products to enable AI-powered demand forecasting. Currently showing threshold-based alerts only.`,
          action: 'Place your first orders to enable intelligent recommendations',
          daysOfHistoryNeeded: 28 - historyDays,
        },
      });
      // Still generate price comparison and alternatives (don't need history for these)
    }

    // Instantiate seasonality engine for today's date (Hijri calendar-based)
    const seasonality = new SeasonalityEngine(today);

    const catalogByProduct = new Map<string, SupplierCatalogItem[]>();
    for (const item of supplierCatalog) {
      if (!catalogByProduct.has(item.productId)) catalogByProduct.set(item.productId, []);
      catalogByProduct.get(item.productId).push(item);
    }

    // ── Rule 1 & 2: Reorder + Price Comparison (low-stock items) ─────────────
    // Skip REORDER rules if insufficient history — risk levels would be wrong.
    //
    // Trigger = max(manual minThreshold, demand-based reorder point). This unifies
    // the static pharmacist-set floor with the EOQ reorder point so that a product
    // selling faster than usual (e.g. Panadol in a demand surge) is flagged BEFORE
    // it drops below the old static minimum — without ever overwriting the manual
    // value the pharmacist configured.
    const reorderTrigger = (i: InventoryItem): number => {
      const sched = scheduleData.get(i.productId);
      const rop = sched?.reorderPoint != null ? Math.ceil(Number(sched.reorderPoint)) : 0;
      return Math.max(i.minThreshold ?? 0, rop);
    };
    for (const item of hasInsufficientHistory ? [] : inventoryItems.filter((i) => i.quantity <= reorderTrigger(i))) {
      const product = item.product;
      const productName = product?.name ?? 'Unknown';
      const category = product?.category ?? '';

      const signal = this.demand.getSignal(item.productId, orderHistory);
      // Hijri calendar-based seasonal adjustment (replaces hardcoded month rules)
      const hijriSignal         = seasonality.getSignal(category);
      const seasonMultiplier    = hijriSignal.multiplier - 1.0; // delta from 1.0 baseline
      const adjustedDailyUsage  = signal.dailyUsage * hijriSignal.multiplier;

      // Use dynamic lead time from EOQ schedule if available, else default 14 days
      const schedule          = scheduleData.get(item.productId);
      const effectiveLeadDays = schedule?.effectiveLeadTimeDays
        ? Number(schedule.effectiveLeadTimeDays)
        : 14;

      const stockDaysRemaining = this.risk.stockDays(item.quantity, adjustedDailyUsage);
      const riskLevel          = this.risk.assess(stockDaysRemaining, effectiveLeadDays);

      // Use EOQ quantity if available (more accurate than simple formula)
      const suggestedQty = schedule?.eoqQty
        ? Math.ceil(Number(schedule.eoqQty))
        : this.risk.suggestedReorderQty(adjustedDailyUsage, item.quantity, effectiveLeadDays);

      // ── Rule 7: Margin-aware restock prioritisation ──────────────────────────
      // When cash is tight a pharmacist can't restock everything at once. We rank
      // each reorder by *profit velocity* = how many EGP of gross profit this item
      // earns per day — so the fast-moving, high-margin medicines get restocked
      // first. Decimal columns arrive as strings → coerce with Number().
      const costPrice    = item.costPrice != null ? Number(item.costPrice) : 0;
      const sellingPrice = item.sellingPrice != null ? Number(item.sellingPrice) : 0;
      const unitMargin   = sellingPrice > 0 && costPrice > 0 ? sellingPrice - costPrice : 0;
      const marginPct    = sellingPrice > 0 && costPrice > 0
        ? Math.round((unitMargin / sellingPrice) * 100)
        : null;
      // Daily gross profit you forfeit while this item is out of stock.
      const profitVelocity = Math.round(unitMargin * adjustedDailyUsage * 100) / 100;
      // Cash needed to act on this reorder (helps the pharmacist budget).
      const restockCost = Math.round(suggestedQty * costPrice * 100) / 100;
      // Plain-Arabic tier for the non-technical end user.
      const priorityTier: 'high' | 'medium' | 'low' =
        profitVelocity >= 50 ? 'high' : profitVelocity >= 15 ? 'medium' : 'low';
      const priorityLabel =
        priorityTier === 'high'
          ? 'أولوية عالية — ربح يومي مرتفع'
          : priorityTier === 'medium'
            ? 'أولوية متوسطة'
            : 'أولوية منخفضة';

      // Pick the most reliable available supplier for the suggestion
      const availableListings = (catalogByProduct.get(item.productId) ?? []).filter((l) => l.isAvailable);
      const recommendedSupplier = this.pickBestSupplier(availableListings, supplierScores);

      recs.push({
        type: RecommendationType.REORDER,
        productId: item.productId,
        riskLevel,
        payload: {
          productId: item.productId,
          productName,
          currentQuantity: item.quantity,
          minThreshold: item.minThreshold,
          effectiveReorderPoint: reorderTrigger(item),
          deficit: Math.max(0, reorderTrigger(item) - item.quantity),
          stockDays: stockDaysRemaining,
          suggestedReorderQty: suggestedQty,
          recommendedSupplier: recommendedSupplier
            ? { tenantId: recommendedSupplier.supplierTenantId, reliabilityLabel: supplierScores.get(recommendedSupplier.supplierTenantId)?.reliabilityLabel ?? 'unknown' }
            : null,
          // Margin-aware restock prioritisation (Rule 7) — lets a cash-constrained
          // pharmacist restock the most profitable fast-movers first.
          economics: {
            costPrice,
            sellingPrice,
            unitMargin: Math.round(unitMargin * 100) / 100,
            marginPct,
            profitVelocity,   // EGP/day of gross profit lost while out of stock
            restockCost,      // EGP needed to fulfil suggestedReorderQty
            priorityTier,
            priorityLabel,
          },
          demand: {
            avg30: Math.round(signal.avg30 * 10) / 10,
            avg90: Math.round(signal.avg90 * 10) / 10,
            trend: signal.trend,
            dailyUsage: Math.round(adjustedDailyUsage * 10) / 10,
          },
          seasonality: {
            event:             hijriSignal.eventName,
            source:            hijriSignal.source,
            multiplier:        hijriSignal.multiplier,
            adjustmentApplied: hijriSignal.multiplier !== 1.0,
          },
          eoq: schedule ? {
            eoqQty:              Number(schedule.eoqQty),
            safetyStockQty:      Number(schedule.safetyStockQty),
            reorderPoint:        Number(schedule.reorderPoint),
            effectiveLeadDays,
          } : null,
          forecast: forecastData.get(item.productId) ? {
            forecastedQty14d: Number(forecastData.get(item.productId)!.forecastedQty),
            trend:            forecastData.get(item.productId)!.trend,
            ciLow:            Number(forecastData.get(item.productId)!.confidenceIntervalLow),
            ciHigh:           Number(forecastData.get(item.productId)!.confidenceIntervalHigh),
          } : null,
        },
      });

      // Price comparison if multiple suppliers available
      if (availableListings.length > 1) {
        const sorted = [...availableListings].sort((a, b) => Number(a.price) - Number(b.price));
        const maxPrice = Number(sorted[sorted.length - 1].price);
        const options = sorted.map((l) => {
          const price = Number(l.price);
          const score = supplierScores.get(l.supplierTenantId);
          return {
            supplierTenantId: l.supplierTenantId,
            supplierName: l.supplierTenant?.name ?? 'Unknown Supplier',
            price,
            currency: l.currency,
            stock: l.stock,
            savings: maxPrice > 0 ? Math.round(((maxPrice - price) / maxPrice) * 100) : 0,
            reliabilityLabel: score?.reliabilityLabel ?? 'unknown',
            reliabilityScore: score ? Number(score.overallScore) : null,
          };
        });

        recs.push({
          type: RecommendationType.PRICE_COMPARISON,
          productId: item.productId,
          riskLevel,
          payload: {
            productId: item.productId,
            productName,
            options,
            cheapestSupplier: options[0].supplierName,
            maxSavings: options[0].savings,
          },
        });
      }
    }

    // ── Rule 3: Alternative (product unavailable from all suppliers) ──────────
    for (const item of inventoryItems) {
      const product = item.product;
      if (!product?.genericName) continue;
      const listings = catalogByProduct.get(item.productId) ?? [];
      if (listings.length > 0 && listings.some((l) => l.isAvailable)) continue;

      const signal = this.demand.getSignal(item.productId, orderHistory);
      const riskLevel = this.risk.assess(this.risk.stockDays(item.quantity, signal.dailyUsage), 14);

      const alternatives = new Map<string, { productId: string; productName: string; supplierCount: number }>();
      for (const catalogItem of supplierCatalog) {
        if (!catalogItem.isAvailable || catalogItem.productId === item.productId) continue;
        const alt = catalogItem.product;
        if (!alt || alt.genericName !== product.genericName) continue;
        if (!alternatives.has(alt.id)) alternatives.set(alt.id, { productId: alt.id, productName: alt.name, supplierCount: 0 });
        alternatives.get(alt.id).supplierCount += 1;
      }

      if (alternatives.size > 0) {
        recs.push({
          type: RecommendationType.ALTERNATIVE,
          productId: item.productId,
          riskLevel,
          payload: {
            unavailableProductId: item.productId,
            unavailableProductName: product.name,
            genericName: product.genericName,
            alternatives: Array.from(alternatives.values()).sort((a, b) => b.supplierCount - a.supplierCount),
          },
        });
      }
    }

    // ── Rule 4: Dead stock alert (no consumption in 60+ days) ────────────────
    if (consumptionData.size > 0) {
      for (const item of inventoryItems) {
        if (item.quantity === 0) continue;
        const snapshots = consumptionData.get(item.productId) ?? [];
        const recentActivity = snapshots.slice(0, 8).some((s) => s.quantityConsumed > 0);
        if (!recentActivity && snapshots.length >= 8) {
          recs.push({
            type: RecommendationType.DEAD_STOCK_ALERT,
            productId: item.productId,
            riskLevel: 'LOW',
            payload: {
              inventoryItemId:     item.id,
              productId:           item.productId,
              productName:         item.product?.name ?? 'Unknown',
              currentQuantity:     item.quantity,
              weeksWithoutMovement: snapshots.length,
            },
          });
        }
      }
    }

    // ── Rule 5: Consumption spike ─────────────────────────────────────────────
    if (consumptionData.size > 0) {
      for (const item of inventoryItems) {
        const snapshots = consumptionData.get(item.productId) ?? [];
        if (snapshots.length < 5) continue;
        const current = snapshots[0].quantityConsumed;
        const avg4w = snapshots.slice(1, 5).reduce((s, r) => s + r.quantityConsumed, 0) / 4;
        if (avg4w > 0 && current > avg4w * 1.5) {
          recs.push({
            type: RecommendationType.CONSUMPTION_SPIKE,
            productId: item.productId,
            riskLevel: 'MEDIUM',
            payload: {
              productId: item.productId,
              productName: item.product?.name ?? 'Unknown',
              currentWeekQty: current,
              avg4WeekQty: Math.round(avg4w),
              spikePercent: Math.round(((current - avg4w) / avg4w) * 100),
            },
          });
        }
      }
    }

    // ── Rule 6: Forecast Alert — demand spike predicted in next 14 days ──────
    if (forecastData.size > 0) {
      for (const item of inventoryItems) {
        const forecast = forecastData.get(item.productId);
        if (!forecast || forecast.trend !== 'increasing') continue;

        const signal   = this.demand.getSignal(item.productId, orderHistory);
        const current14d = signal.dailyUsage * 14;

        // Alert if forecast is >30% above current consumption trend
        if (
          current14d > 0 &&
          Number(forecast.forecastedQty) > current14d * 1.30
        ) {
          const increasePercent = Math.round(
            ((Number(forecast.forecastedQty) - current14d) / current14d) * 100,
          );
          recs.push({
            type:      RecommendationType.FORECAST_ALERT,
            productId: item.productId,
            riskLevel: increasePercent >= 60 ? 'HIGH' : 'MEDIUM',
            payload: {
              productId:         item.productId,
              productName:       item.product?.name ?? 'Unknown',
              currentQuantity:   item.quantity,
              forecastedQty14d:  Number(forecast.forecastedQty),
              currentTrend14d:   Math.round(current14d),
              increasePercent,
              ciLow:  Number(forecast.confidenceIntervalLow),
              ciHigh: Number(forecast.confidenceIntervalHigh),
              algorithm: forecast.algorithm,
            },
          });
        }
      }
    }

    // ── Rule 7: Proactive Reorder Schedule — "order by DATE to avoid stockout" ─
    if (scheduleData.size > 0) {
      for (const item of inventoryItems) {
        const schedule = scheduleData.get(item.productId);
        if (!schedule?.reorderByDate || !schedule.daysUntilReorderNeeded) continue;

        const days = Number(schedule.daysUntilReorderNeeded);

        // Only surface if reorder is needed within 7 days and stock is NOT already
        // below threshold (REORDER rule already covers that case)
        if (days <= 7 && item.quantity > item.minThreshold) {
          recs.push({
            type:      RecommendationType.REORDER_SCHEDULE,
            productId: item.productId,
            riskLevel: days <= 2 ? 'HIGH' : days <= 5 ? 'MEDIUM' : 'LOW',
            payload: {
              productId:                 item.productId,
              productName:               item.product?.name ?? 'Unknown',
              currentQuantity:           item.quantity,
              reorderByDate:             schedule.reorderByDate,
              predictedStockoutDate:     schedule.predictedStockoutDate,
              daysUntilReorderNeeded:    days,
              eoqQty:                    Number(schedule.eoqQty),
              recommendedSupplierTenantId: schedule.recommendedSupplierTenantId,
            },
          });
        }
      }
    }

    // ── Rule 7b: Expired Quarantine — items past expiry date still in stock ─────
    for (const item of inventoryItems) {
      if (!item.expiryDate || item.quantity <= 0) continue;
      const expiry = new Date(item.expiryDate);
      if (expiry >= today) continue; // not expired yet

      const daysPastExpiry = Math.floor((Date.now() - expiry.getTime()) / 86_400_000);
      recs.push({
        type: RecommendationType.EXPIRED_QUARANTINE,
        productId: item.productId,
        riskLevel: 'HIGH',
        payload: {
          inventoryItemId: item.id,
          productId: item.productId,
          productName: item.product?.name ?? 'Unknown',
          productNameAr: (item.product as any)?.nameAr ?? null,
          quantity: item.quantity,
          expiryDate: item.expiryDate,
          daysPastExpiry,
          action: 'quarantine_and_remove',
          deepLink: `/pharmacy/inventory?filter=expired`,
        },
      });
    }

    // ── Rule 8: P2P Listing Suggestion — near-expiry or dead stock → list on PEN ─
    const DAY_MS = 86_400_000;
    const now90  = new Date(Date.now() + 90 * DAY_MS);
    const now60  = new Date(Date.now() + 60 * DAY_MS);
    const now30  = new Date(Date.now() + 30 * DAY_MS);

    for (const item of inventoryItems) {
      if (!item.expiryDate || item.quantity <= 0) continue;
      const expiry = new Date(item.expiryDate);
      if (expiry <= today) continue; // already expired — skip, can't list
      if (expiry > now90) continue;  // more than 90 days away — no urgency yet

      const daysLeft = Math.floor((expiry.getTime() - Date.now()) / DAY_MS);

      // Skip if a dead-stock rule was already generated for this item (don't double-alert)
      const alreadyHasDeadStock = recs.some(
        (r) => r.type === RecommendationType.DEAD_STOCK_ALERT && r.productId === item.productId,
      );

      let riskLevel: RiskLevel;
      let discountPct: number;
      let listingType: 'clearance' | 'emergency';

      if (expiry <= now30) {
        riskLevel   = 'HIGH';
        discountPct = 20;
        listingType = 'clearance';
      } else if (expiry <= now60) {
        riskLevel   = 'HIGH';
        discountPct = 15;
        listingType = 'clearance';
      } else {
        riskLevel   = 'MEDIUM';
        discountPct = 10;
        listingType = 'clearance';
      }

      recs.push({
        type: RecommendationType.P2P_LISTING_SUGGESTION,
        productId: item.productId,
        riskLevel,
        payload: {
          inventoryItemId:    item.id,
          productId:          item.productId,
          productName:        item.product?.name ?? 'Unknown',
          productNameAr:      (item.product as any)?.nameAr ?? null,
          quantity:           item.quantity,
          expiryDate:         item.expiryDate,
          daysLeft,
          suggestedListingType: listingType,
          suggestedDiscountPct: discountPct,
          alreadyHasDeadStock,
          action: 'list_on_p2p',
          deepLink: `/pharmacy/p2p?tab=sell&openAdd=1&itemId=${item.id}`,
        },
      });
    }

    // ── Rule 9: SMART_PROCUREMENT — P2P price beats supplier for a low-stock item ─
    // Detects: "another pharmacy has your low-stock product listed on the P2P
    // marketplace cheaper than any supplier".
    const { p2pListings = [] } = ctx;
    if (p2pListings.length > 0) {
      const p2pByProduct = new Map<string, P2pListingSlim[]>();
      for (const l of p2pListings) {
        if (!p2pByProduct.has(l.productId)) p2pByProduct.set(l.productId, []);
        p2pByProduct.get(l.productId)!.push(l);
      }

      // Only fire for items already triggering REORDER (avoids double-alerting healthy stock)
      const reorderProductIds = new Set(
        recs.filter(r => r.type === RecommendationType.REORDER).map(r => r.productId),
      );

      for (const item of inventoryItems) {
        if (!item.productId) continue;
        if (!reorderProductIds.has(item.productId)) continue;

        const p2pOptions = p2pByProduct.get(item.productId) ?? [];
        if (!p2pOptions.length) continue;

        // Pick the cheapest available P2P listing with enough quantity
        const deficit = Math.max(1, Number(item.minThreshold ?? 0) - Number(item.quantity ?? 0));
        const viable  = p2pOptions
          .filter(l => Number(l.quantity) >= Number(l.minOrderQty))
          .sort((a, b) => Number(a.price) - Number(b.price));
        if (!viable.length) continue;
        const best = viable[0];
        const p2pPrice = Number(best.price);

        // Compare against cheapest available supplier
        const supplierOptions = (catalogByProduct.get(item.productId) ?? []).filter(l => l.isAvailable);
        const cheapestSupplierPrice = supplierOptions.length
          ? Math.min(...supplierOptions.map(l => Number(l.price)))
          : Infinity;

        // Only recommend if P2P is meaningfully cheaper (>5%) or no supplier at all
        const saving = cheapestSupplierPrice < Infinity
          ? (cheapestSupplierPrice - p2pPrice) / cheapestSupplierPrice
          : 1;
        if (saving < 0.05 && cheapestSupplierPrice < Infinity) continue;

        const savingsPct = cheapestSupplierPrice < Infinity
          ? Math.round(saving * 100)
          : 0;

        recs.push({
          type:      RecommendationType.SMART_PROCUREMENT,
          productId: item.productId,
          riskLevel: Number(item.quantity ?? 0) === 0 ? 'HIGH' : 'MEDIUM',
          payload: {
            productId:    item.productId,
            productName:  item.product?.name ?? 'Unknown',
            productNameAr: (item.product as any)?.nameAr ?? null,
            currentQuantity: Number(item.quantity ?? 0),
            minThreshold: Number(item.minThreshold ?? 0),
            deficit,
            bestListing: {
              listingId:       best.id,
              sellerTenantId:  best.sellerTenantId,
              price:           p2pPrice,
              quantity:        Number(best.quantity),
              minOrderQty:     Number(best.minOrderQty),
              listingType:     best.listingType,
              discountPct:     best.discountPct,
              expiryDate:      best.expiryDate,
            },
            p2pPrice,
            supplierPrice:  cheapestSupplierPrice < Infinity ? cheapestSupplierPrice : null,
            savingsPct,
            totalListings:  p2pOptions.length,
            deepLink:       `/pharmacy/p2p?tab=buy&productId=${item.productId}`,
          },
        });
      }
    }

    const riskOrder: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return recs.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);
  }

  /** Pick the most reliable available supplier (highest overallScore, then cheapest) */
  private pickBestSupplier(
    listings: SupplierCatalogItem[],
    scores: Map<string, SupplierReliabilityScore>,
  ): SupplierCatalogItem | null {
    if (!listings.length) return null;
    return listings.reduce((best, listing) => {
      if (!best) return listing;
      const bestScore  = Number(scores.get(best.supplierTenantId)?.overallScore ?? 0);
      const thisScore  = Number(scores.get(listing.supplierTenantId)?.overallScore ?? 0);
      if (thisScore !== bestScore) return thisScore > bestScore ? listing : best;
      return Number(listing.price) < Number(best.price) ? listing : best;
    }, null as SupplierCatalogItem | null);
  }
}

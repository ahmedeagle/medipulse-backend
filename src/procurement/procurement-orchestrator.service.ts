import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { DemandForecastingService } from '../forecasting/demand-forecasting.service';
import { ConsumptionAnalyticsService } from '../inventory/consumption-analytics.service';
import { P2pMarketplaceService } from '../p2p-marketplace/p2p-marketplace.service';
import { SupplierService } from '../supplier/supplier.service';
import { SupplierReliabilityService } from '../supplier/supplier-reliability.service';
import { MarketAvailabilityService } from '../supplier/market-availability.service';
import { FinancialService } from '../financial/financial.service';
import { CashFlowProjector } from '../financial/cash-flow-projector.service';
import { AnalyticsReadService } from '../analytics/analytics-read.service';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Product } from '../inventory/entities/product.entity';
import { ConflictResolutionEngine } from './conflict-resolution.engine';
import {
  FinancialStatus,
  NormalizedSignalBundle,
  OrchestratorResult,
  P2PListingOption,
  PlanSplit,
  RejectedOption,
  SimulationConstraints,
  SupplierOptionWithScore,
  DelayRecommendation,
  OverpaymentRecommendation,
} from './procurement-orchestrator.types';

/** Wraps a promise with a timeout — returns null on timeout instead of throwing */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string, logger: Logger): Promise<T | null> {
  const timer = new Promise<null>((resolve) =>
    setTimeout(() => {
      logger.warn(`Signal collection timeout (${ms}ms): ${label}`);
      resolve(null);
    }, ms),
  );
  return Promise.race([promise, timer]) as Promise<T | null>;
}

const SIGNAL_TIMEOUT_MS = 4_000;
const LEAD_TIME_DAYS_DEFAULT = 3;
const SAFETY_BUFFER_DAYS_DEFAULT = 7;

@Injectable()
export class ProcurementOrchestrator {
  private readonly logger = new Logger(ProcurementOrchestrator.name);

  constructor(
    private readonly forecasting: DemandForecastingService,
    private readonly consumption: ConsumptionAnalyticsService,
    private readonly p2p: P2pMarketplaceService,
    private readonly supplier: SupplierService,
    private readonly reliability: SupplierReliabilityService,
    private readonly marketAvailability: MarketAvailabilityService,
    private readonly financial: FinancialService,
    private readonly cashFlow: CashFlowProjector,
    private readonly analytics: AnalyticsReadService,
    private readonly conflictEngine: ConflictResolutionEngine,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  // ─── PUBLIC API ─────────────────────────────────────────────────────────────

  async generatePlan(
    tenantId: string,
    productId: string,
    qtyNeeded: number,
    constraints: SimulationConstraints = {},
  ): Promise<OrchestratorResult> {
    this.logger.log(`Generating procurement plan: tenant=${tenantId} product=${productId} qty=${qtyNeeded}`);

    // ── LAYER 1: Parallel signal collection ───────────────────────────────
    const signals = await this.collectSignals(tenantId, productId, qtyNeeded, constraints);

    // Current stock — used by conflict engine (fetched separately to keep types clean)
    const stockTotal = await this.getCurrentStock(tenantId, productId);
    const safetyStock = await this.getSafetyStock(tenantId, productId);

    // ── LAYER 2: Signal normalization ─────────────────────────────────────
    const normalized = this.normalizeSignals(signals, qtyNeeded);

    // Apply simulation constraints (override signals for "what-if" scenarios)
    if (constraints.sourceFilter === 'p2p_only') normalized.supplierOptions = [];
    if (constraints.sourceFilter === 'supplier_only') normalized.p2pAvailable = [];
    if (constraints.excludeSupplierIds?.length) {
      normalized.supplierOptions = normalized.supplierOptions.filter(
        (s) => !constraints.excludeSupplierIds!.includes(s.supplierTenantId),
      );
    }
    if (constraints.delayDays && constraints.delayDays > 0) {
      // Simulated delay: adjust urgency downward
      const delayFactor = Math.max(0, 1 - constraints.delayDays / 14);
      normalized.urgencyScore = Math.round(normalized.urgencyScore * delayFactor);
    }

    // ── LAYER 3: Conflict resolution ──────────────────────────────────────
    const resolved = this.conflictEngine.apply(normalized, {
      currentStock: stockTotal,
      safetyStock,
    });

    // ── LAYER 4: Plan generation + risk scoring + explainability ──────────
    const plan = this.generateSplitPlan(
      productId,
      signals.productName,
      resolved,
      signals,
      stockTotal,
      safetyStock,
      constraints.triggerEvent ?? 'manual',
    );

    // ── LAYER 5: Counter-recommendation ("should we delay?") ──────────────
    // Pure rule-based; never calls GPT — cost stays zero at scale.
    plan.delayRecommendation = await this.evaluateDelay(
      tenantId,
      plan,
      normalized,
      stockTotal,
      safetyStock,
    );

    // ── LAYER 6: Overpayment counter-recommendation ───────────────────────
    // Pure rule-based; reads from PriceIntelligence (suppliers + P2P).
    plan.overpaymentRecommendation = await this.evaluateOverpayment(
      tenantId,
      productId,
      plan,
    );

    return plan;
  }

  // ─── LAYER 1: SIGNAL COLLECTION ──────────────────────────────────────────────

  private async collectSignals(
    tenantId: string,
    productId: string,
    qtyNeeded: number,
    constraints: SimulationConstraints,
  ) {
    // Batch 1: independent calls (no inter-dependency)
    const [forecasts, snapshots, wallet, supplierCatalog, regionalPricing, marketAvail, product] =
      await Promise.all([
        withTimeout(
          this.forecasting.getForecasts(tenantId, productId),
          SIGNAL_TIMEOUT_MS, 'ForecastingService', this.logger,
        ),
        withTimeout(
          this.consumption.getSnapshots(tenantId, productId, 8),
          SIGNAL_TIMEOUT_MS, 'ConsumptionAnalytics', this.logger,
        ),
        constraints.warmCache && 'wallet' in constraints.warmCache
          ? Promise.resolve(constraints.warmCache.wallet as any)
          : withTimeout(
              this.financial.getWallet(tenantId),
              SIGNAL_TIMEOUT_MS, 'FinancialService', this.logger,
            ),
        withTimeout(
          this.supplier.findCatalogByProduct(productId),
          SIGNAL_TIMEOUT_MS, 'SupplierService', this.logger,
        ),
        withTimeout(
          this.analytics.getRegionalPricing(productId),
          SIGNAL_TIMEOUT_MS, 'AnalyticsRead', this.logger,
        ),
        withTimeout(
          this.marketAvailability.getLatest(productId),
          SIGNAL_TIMEOUT_MS, 'MarketAvailabilityService', this.logger,
        ),
        // Lightweight DB lookup — no timeout needed
        this.productRepo.findOne({
          select: ['id', 'name', 'nameAr'],
          where: { id: productId },
        }),
      ]);

    const latestForecast = (forecasts ?? []).at(-1) ?? null;
    const isSpiking = snapshots ? this.consumption.isSpiking(snapshots) : false;

    // Filter catalog: only available + in stock
    const availableSuppliers = (supplierCatalog ?? []).filter(
      (s) => s.isAvailable && s.stock > 0,
    );

    // Batch 2: calls that depend on Batch 1
    const supplierIds = availableSuppliers.map((s) => s.supplierTenantId);
    const [p2pResult, reliabilityMap] = await Promise.all([
      withTimeout(
        this.p2p.search(tenantId, { q: product?.name ?? '', limit: 10 }),
        SIGNAL_TIMEOUT_MS, 'P2pMarketplace', this.logger,
      ),
      supplierIds.length > 0
        ? withTimeout(
            this.reliability.getScores(supplierIds),
            SIGNAL_TIMEOUT_MS, 'ReliabilityService', this.logger,
          )
        : Promise.resolve(new Map()),
    ]);

    // Build typed supplier options with reliability scores merged in
    const supplierOptions: SupplierOptionWithScore[] = availableSuppliers
      .map((catalog) => {
        const score = (reliabilityMap ?? new Map()).get(catalog.supplierTenantId);
        return {
          supplierTenantId: catalog.supplierTenantId,
          companyName: (catalog as any).supplierTenant?.name ?? 'مورد',
          unitPrice: Number(catalog.price),
          stock: catalog.stock,
          currency: catalog.currency,
          // overallScore is a Postgres decimal → TypeORM returns it as a string.
          // Coerce to number so downstream math + JSON stays numeric.
          reliabilityScore: Number(score?.overallScore ?? 50),
          reliabilityLabel: score?.reliabilityLabel ?? 'medium',
          avgDeliveryDays: score?.avgDeliveryDays ?? LEAD_TIME_DAYS_DEFAULT,
        };
      })
      .sort((a, b) => b.reliabilityScore - a.reliabilityScore); // best reliability first

    // Build typed P2P options
    const p2pListings: P2PListingOption[] = (p2pResult?.data ?? [])
      .map((r) => ({
        listingId: r.listing.id,
        sellerTenantId: (r.listing as any).sellerTenantId ?? '',
        sellerName: r.seller?.legalName ?? 'صيدلية',
        qty: (r.listing as any).quantity ?? 0,
        unitPrice: Number((r.listing as any).price ?? 0),
        // overallScore is a Postgres decimal → string; coerce to number.
        sellerScore: Number(r.reliability?.overallScore ?? 50),
        rankScore: r.rankScore,
      }))
      .filter((l) => l.qty > 0 && l.unitPrice > 0)
      .sort((a, b) => a.unitPrice - b.unitPrice); // cheapest first

    // Price volatility from regional pricing (stddev of price changes)
    const priceChanges = (regionalPricing ?? [])
      .map((r) => r.priceChange30d ?? 0)
      .filter((v) => v !== null);
    const priceVolatility =
      priceChanges.length > 0
        ? Math.sqrt(
            priceChanges.reduce((sum, v) => sum + v * v, 0) / priceChanges.length,
          )
        : 0;

    // Historical avg unit price (from regional pricing)
    const allPrices = (regionalPricing ?? []).map((r) => r.latestPrice).filter(Boolean);
    const avgHistoricalPrice =
      allPrices.length > 0
        ? allPrices.reduce((s, p) => s + p, 0) / allPrices.length
        : 0;

    return {
      productName: product?.name ?? '',
      latestForecast,
      isSpiking,
      wallet,
      supplierOptions,
      p2pListings,
      priceVolatility,
      avgHistoricalPrice,
      marketAvailabilityRate: marketAvail?.availabilityRate ?? 1.0,
      qtyNeeded,
    };
  }

  // ─── LAYER 2: SIGNAL NORMALIZATION ───────────────────────────────────────────

  private normalizeSignals(
    signals: Awaited<ReturnType<typeof this.collectSignals>>,
    qtyNeeded: number,
  ): NormalizedSignalBundle {
    const { latestForecast, isSpiking, wallet, supplierOptions, p2pListings, priceVolatility,
            marketAvailabilityRate } = signals;

    // Urgency score: based on demand spike + forecast trend
    let urgencyScore = 40; // baseline
    if (isSpiking) urgencyScore += 30;
    if (latestForecast?.trend === 'increasing') urgencyScore += 15;
    if (latestForecast?.trend === 'decreasing') urgencyScore -= 10;
    urgencyScore = Math.min(100, Math.max(0, urgencyScore));

    // Financial risk: based on wallet utilization
    let financialRisk: 'low' | 'medium' | 'high' = 'low';
    const creditLimit      = wallet?.creditLimit      ?? 0;
    const utilizedCredit   = wallet?.utilizedCredit   ?? 0;
    const creditAvailable  = Math.max(0, creditLimit - utilizedCredit);
    const utilizationBefore = creditLimit > 0 ? (utilizedCredit / creditLimit) * 100 : 0;
    if (wallet) {
      const utilization = creditLimit > 0 ? utilizedCredit / creditLimit : 0;
      if (wallet.status !== 'active' || utilization > 0.90) financialRisk = 'high';
      else if (utilization > wallet.utilizationAlertThreshold) financialRisk = 'medium';
    }

    // Market shortage: live signal from MarketAvailabilityService (Sprint 3a)
    const marketShortageRisk = marketAvailabilityRate < 0.50;

    // Forecast-based qty: (daily demand × (lead time + buffer)) - current stock
    // This overrides the raw qtyNeeded if forecast data is available
    let qtyRequired = qtyNeeded;
    if (latestForecast?.estimatedDailyDemand) {
      const dailyDemand = latestForecast.estimatedDailyDemand;
      const leadTime = supplierOptions[0]?.avgDeliveryDays ?? LEAD_TIME_DAYS_DEFAULT;
      const buffer = SAFETY_BUFFER_DAYS_DEFAULT;
      const forecastRequired = Math.ceil(dailyDemand * (leadTime + buffer));
      qtyRequired = Math.max(qtyNeeded, forecastRequired);
    }

    return {
      urgencyScore,
      financialRisk,
      marketShortageRisk,
      marketAvailabilityRate,
      priceVolatility,
      qtyRequired,
      p2pAvailable: p2pListings,
      supplierOptions,
    };
  }

  // ─── LAYER 4: PLAN GENERATION ─────────────────────────────────────────────────

  private generateSplitPlan(
    productId: string,
    productName: string,
    resolved: ReturnType<typeof this.conflictEngine.apply>,
    rawSignals: Awaited<ReturnType<typeof this.collectSignals>>,
    currentStock: number,
    safetyStock: number,
    triggerEvent: string,
  ): OrchestratorResult {
    const { signals, resolutions, rejectedSuppliers, overpaymentWarning, p2pPreferred } = resolved;
    const { qtyRequired, p2pAvailable, supplierOptions } = signals;

    const splits: PlanSplit[] = [];
    const rejectedOptions: RejectedOption[] = [];
    let remaining = qtyRequired;

    // Rejected suppliers → rejected options list
    for (const rs of rejectedSuppliers) {
      const catalog = supplierOptions.find((s) => s.supplierTenantId === rs.supplierTenantId);
      if (catalog) {
        rejectedOptions.push({
          name: rs.supplierTenantId,
          type: 'supplier',
          rejectedReason: rs.reason,
        });
      }
    }

    // Fill from P2P first if preferred or rule R6 fired
    if (p2pPreferred && p2pAvailable.length > 0) {
      for (const listing of p2pAvailable) {
        if (remaining <= 0) break;
        const takeQty = Math.min(remaining, listing.qty);
        splits.push({
          source: 'p2p',
          sourceId: listing.listingId,
          sourceName: listing.sellerName,
          qty: takeQty,
          unitPrice: listing.unitPrice,
          reliabilityScore: listing.sellerScore,
          reason: 'أرخص متاح — P2P',
        });
        remaining -= takeQty;
      }
    }

    // Fill remaining from suppliers (highest reliability first)
    const [primarySupplier, ...backupSuppliers] = supplierOptions;
    if (primarySupplier && remaining > 0) {
      const takeQty = Math.min(remaining, primarySupplier.stock);
      if (takeQty > 0) {
        splits.push({
          source: 'supplier',
          sourceId: primarySupplier.supplierTenantId,
          sourceName: primarySupplier.companyName,
          qty: takeQty,
          unitPrice: primarySupplier.unitPrice,
          reliabilityScore: primarySupplier.reliabilityScore,
          reason: 'أعلى موثوقية',
        });
        remaining -= takeQty;
      }
    }

    // Fill remaining from backup supplier
    if (backupSuppliers[0] && remaining > 0) {
      const backup = backupSuppliers[0];
      const takeQty = Math.min(remaining, backup.stock);
      if (takeQty > 0) {
        splits.push({
          source: 'supplier',
          sourceId: backup.supplierTenantId,
          sourceName: backup.companyName,
          qty: takeQty,
          unitPrice: backup.unitPrice,
          reliabilityScore: backup.reliabilityScore,
          reason: 'مورد احتياطي',
        });
        remaining -= takeQty;
      }
    }

    // If P2P not preferred, fill any gap with P2P as last resort
    if (!p2pPreferred && remaining > 0 && p2pAvailable.length > 0) {
      for (const listing of p2pAvailable) {
        if (remaining <= 0) break;
        const takeQty = Math.min(remaining, listing.qty);
        splits.push({
          source: 'p2p',
          sourceId: listing.listingId,
          sourceName: listing.sellerName,
          qty: takeQty,
          unitPrice: listing.unitPrice,
          reliabilityScore: listing.sellerScore,
          reason: 'تكملة من P2P',
        });
        remaining -= takeQty;
      }
    }

    const totalCost = splits.reduce((sum, s) => sum + s.qty * s.unitPrice, 0);
    const insufficientSupply = remaining > 0;

    // Risk Score formula (0–100)
    const leadTimeDays = supplierOptions[0]?.avgDeliveryDays ?? LEAD_TIME_DAYS_DEFAULT;
    const daysOfStock = rawSignals.latestForecast?.estimatedDailyDemand
      ? Math.floor(currentStock / rawSignals.latestForecast.estimatedDailyDemand)
      : 999;

    const stockoutProbability = leadTimeDays > 0
      ? Math.min(1, Math.max(0, (leadTimeDays - daysOfStock) / leadTimeDays))
      : 0;
    const marketShortageContrib = 1 - signals.marketAvailabilityRate;
    const supplierReliabilityRisk =
      splits.filter((s) => s.source === 'supplier').length > 0
        ? 1 -
          (splits
            .filter((s) => s.source === 'supplier')
            .reduce((sum, s) => sum + (s.reliabilityScore ?? 50), 0) /
            (splits.filter((s) => s.source === 'supplier').length * 100))
        : 0;
    const creditLimit     = rawSignals.wallet?.creditLimit     ?? 0;
    const utilizedCredit  = rawSignals.wallet?.utilizedCredit  ?? 0;
    const creditAvailable = Math.max(0, creditLimit - utilizedCredit);
    const creditUtil = creditLimit > 0 ? utilizedCredit / creditLimit : 0;
    const utilizationBefore = creditUtil * 100;
    const financialHealthRisk = Math.min(1, creditUtil);

    const riskScore = Math.round(
      stockoutProbability * 35 +
      marketShortageContrib * 25 +
      supplierReliabilityRisk * 20 +
      financialHealthRisk * 20,
    );

    // Confidence: decreases with missing data
    let confidence = 90;
    if (!rawSignals.latestForecast) confidence -= 15;
    if (rawSignals.supplierOptions.length === 0) confidence -= 20;
    if (rawSignals.p2pListings.length === 0) confidence -= 5;
    if (insufficientSupply) confidence -= 20;
    confidence = Math.max(0, Math.min(100, confidence));

    const planReasons: string[] = [];
    if (rawSignals.isSpiking) planReasons.push('تم رصد ارتفاع في الطلب');
    if (p2pPreferred) planReasons.push('P2P أرخص — تم الأولوية له');
    if (overpaymentWarning) planReasons.push('تحذير: تقلب في الأسعار');
    if (insufficientSupply) planReasons.push('⚠️ كميات غير كافية في السوق');

    const savedVsAvg =
      rawSignals.avgHistoricalPrice > 0
        ? (rawSignals.avgHistoricalPrice - totalCost / Math.max(1, qtyRequired)) * qtyRequired
        : 0;

    const utilizationAfter = creditLimit > 0
      ? Math.min(100, ((utilizedCredit + totalCost) / creditLimit) * 100)
      : 0;
    const financialStatus: FinancialStatus = {
      creditAvailable,
      creditLimit,
      utilizationBeforePurchase: Math.round(utilizationBefore * 10) / 10,
      utilizationAfterPurchase: Math.round(utilizationAfter * 10) / 10,
      cashRisk: signals.financialRisk,
      recommendation:
        signals.financialRisk === 'high'
          ? 'delay_recommended'
          : signals.financialRisk === 'medium'
          ? 'approve_with_caution'
          : 'approve_now',
    };

    return {
      productId,
      productName,
      qtyRequired,
      splits,
      totalCost,
      riskScore,
      confidence,
      insufficientSupply,
      financialStatus,
      // Default to null \u2014 generatePlan() fills this from evaluateDelay()
      // after the synchronous split-plan generation completes.
      delayRecommendation: null,
      overpaymentRecommendation: null,
      explainability: {
        triggerEvent: (triggerEvent as any) ?? 'manual',
        inputsSnapshot: {
          demandForecastUnits: rawSignals.latestForecast?.forecastedQty ?? 0,
          currentStockUnits: currentStock,
          financialHealthSummary: {
            cashRisk: signals.financialRisk === 'high',
            creditUtilization: creditUtil,
          },
          marketAvailabilityRate: signals.marketAvailabilityRate,
          p2pListingsCount: p2pAvailable.length,
          supplierOptionsCount: supplierOptions.length,
          lastAvgUnitPrice: rawSignals.avgHistoricalPrice,
        },
        computedSignals: {
          urgencyScore: signals.urgencyScore,
          financialRisk: signals.financialRisk,
          marketShortageRisk: signals.marketShortageRisk,
          priceVolatility: signals.priceVolatility,
        },
        conflictResolutions: resolutions,
        rejectedOptions,
        selectedPlanReason:
          planReasons.length > 0 ? planReasons.join(' | ') : 'خطة قياسية بناءً على الموثوقية والسعر',
        financialImpact: {
          totalCost,
          savedVsHistoricalAvg: savedVsAvg,
          financialWarning: signals.financialRisk === 'high',
          financialWarningReason:
            signals.financialRisk === 'high'
              ? 'نسبة الائتمان المستخدمة مرتفعة — يُنصح بتخفيض الكميات'
              : undefined,
        },
        riskScore,
        confidence,
      },
    };
  }

  // ─── LAYER 5: DELAY EVALUATION (pure rules — zero AI cost) ───────────────────

  /**
   * Decides whether the system should suggest delaying the purchase.
   *
   * Rules (evaluated in order — first match wins):
   *
   *   R1  Stockout safety: if current stock is at/below safety, never delay.
   *   R2  Critical urgency: if urgencyScore >= 80 (demand spike / market
   *        shortage / sub-safety stock pressure), never delay.
   *   R3  Cash-inflow cover: if projected 7-day inflow covers totalCost AND
   *        financialRisk is medium/high, recommend delay equal to
   *        daysToCover (capped at 7).
   *   R4  Low-urgency + tight finances: urgencyScore < 50 AND financialRisk
   *        = high → recommend a conservative 3-day delay so the next POS
   *        cycle eases credit utilization.
   *
   * Returns null when none fire.
   *
   * Note: this never mutates the plan. WhatsApp/UI renders both the
   * "act now" plan and the optional "or wait N days" counter-card so the
   * user picks. WhatsApp remains a renderer, never a source of truth.
   */
  private async evaluateDelay(
    tenantId: string,
    plan: OrchestratorResult,
    signals: NormalizedSignalBundle,
    currentStock: number,
    safetyStock: number,
  ): Promise<DelayRecommendation | null> {
    // R1 — safety floor: stock is already at risk, do NOT delay.
    if (currentStock <= safetyStock) return null;

    // R2 — critical urgency: market shortage, spike, etc. dominate.
    if (signals.urgencyScore >= 80) return null;

    // Nothing to delay if cost is trivially zero (defensive).
    if (plan.totalCost <= 0) return null;

    let projection;
    try {
      projection = await this.cashFlow.project(tenantId, 7);
    } catch (err) {
      this.logger.warn(`evaluateDelay: cash-flow projection failed: ${(err as Error).message}`);
      return null;
    }

    if (projection.source === 'insufficient_history') {
      // Without enough POS history we cannot justify a delay claim.
      return null;
    }

    const daysToCover = projection.daysToCoverFn(plan.totalCost);

    // R3 — projected inflow covers cost AND finances are stressed
    if (
      daysToCover !== null &&
      daysToCover >= 1 &&
      (signals.financialRisk === 'high' || signals.financialRisk === 'medium')
    ) {
      const days = Math.min(7, daysToCover);
      return {
        recommendedDelayDays: days,
        reasonCode: 'cash_inflow_expected',
        humanReason:
          `سيغطي تدفق المبيعات المتوقع التكلفة خلال ${days} أيام — يمكن تأجيل الطلب لتخفيف الضغط على الائتمان.`,
        projectedInflow: projection.totalProjectedInflow,
        daysToCoverCost: daysToCover,
        confidence: signals.financialRisk === 'high' ? 'high' : 'medium',
      };
    }

    // R4 — low urgency + high financial risk → small conservative delay
    if (signals.urgencyScore < 50 && signals.financialRisk === 'high') {
      return {
        recommendedDelayDays: 3,
        reasonCode: 'low_urgency_high_finrisk',
        humanReason:
          'الطلب غير عاجل والائتمان مرتفع — يُنصح بالتأجيل ٣ أيام حتى تتحسن السيولة.',
        projectedInflow: projection.totalProjectedInflow,
        daysToCoverCost: daysToCover,
        confidence: 'medium',
      };
    }

    return null;
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────────

  private async getCurrentStock(tenantId: string, productId: string): Promise<number> {
    try {
      const result = await this.inventoryRepo
        .createQueryBuilder('item')
        .select('COALESCE(SUM(item.quantity), 0)', 'total')
        .where('item.pharmacyTenantId = :tenantId', { tenantId })
        .andWhere('item.productId = :productId', { productId })
        .andWhere('item.deletedAt IS NULL')
        .getRawOne<{ total: string }>();
      return parseInt(result?.total ?? '0', 10);
    } catch {
      return 0;
    }
  }

  private async getSafetyStock(tenantId: string, productId: string): Promise<number> {
    try {
      const item = await this.inventoryRepo.findOne({
        select: ['minThreshold'],
        where: { pharmacyTenantId: tenantId, productId, deletedAt: IsNull() },
      });
      return item?.minThreshold ?? 0;
    } catch {
      return 0;
    }
  }

  // ─── LAYER 6: OVERPAYMENT EVALUATION (pure rules — zero AI cost) ─────────────

  /**
   * Decides whether the plan's effective unit price is materially above the
   * market average. Surfaces *before* the pharmacy commits so they can
   * renegotiate, switch supplier, or pick up a marketplace listing.
   *
   * Behaviour:
   *   - Threshold comes from PharmacySettings.aiAnalysisSettings.overpaymentThresholdPct
   *     (default 15 — industry standard for GCC + Egypt B2B pharma).
   *   - Only fires when there's a *cheaper alternative actually available*
   *     (no point telling the user they're overpaying if the market has nothing).
   *   - Marketplace alternatives are explicitly flagged so the UI can deep-link
   *     to the P2P listing instead of just blaming the supplier.
   */
  private async evaluateOverpayment(
    tenantId: string,
    productId: string,
    plan: OrchestratorResult,
  ): Promise<OverpaymentRecommendation | null> {
    if (!plan.splits.length || plan.qtyRequired <= 0 || plan.totalCost <= 0) return null;

    const effectiveUnitPrice = plan.totalCost / plan.qtyRequired;
    if (!Number.isFinite(effectiveUnitPrice) || effectiveUnitPrice <= 0) return null;

    let intel;
    try {
      intel = await this.analytics.getPriceIntelligence(tenantId, productId, 90);
    } catch (err) {
      this.logger.warn(`evaluateOverpayment: price intelligence failed: ${(err as Error).message}`);
      return null;
    }

    const threshold = intel.overpaymentThresholdPct ?? 15;
    const marketAvg = intel.avgPrice;
    if (!marketAvg || marketAvg <= 0) return null;

    const overpaymentPct = Math.round(((effectiveUnitPrice - marketAvg) / marketAvg) * 100);
    if (overpaymentPct <= threshold) return null;

    // Real alternative must exist (otherwise the warning is noise).
    const supplierBest = intel.bestPriceNow;
    const marketBest = intel.marketplaceBestPrice;
    const candidates = [supplierBest, marketBest].filter(
      (v): v is number => v !== null && v < effectiveUnitPrice,
    );
    if (!candidates.length) return null;

    const bestAlt = Math.min(...candidates);
    const bestIsMarketplace = marketBest !== null && marketBest === bestAlt;

    const savingsPerUnit = effectiveUnitPrice - bestAlt;
    const savingsTotal = Math.round(savingsPerUnit * plan.qtyRequired);

    const humanReason = bestIsMarketplace
      ? `السعر أعلى من السوق بنسبة ${overpaymentPct}% — يوجد عرض على السوق المفتوح بسعر ${bestAlt.toFixed(2)} (توفير محتمل: ${savingsTotal}).`
      : `السعر أعلى من المتوسط بنسبة ${overpaymentPct}% — يوجد مورد أرخص بسعر ${bestAlt.toFixed(2)} (توفير محتمل: ${savingsTotal}).`;

    return {
      overpaymentPct,
      thresholdPct: threshold,
      effectiveUnitPrice: Math.round(effectiveUnitPrice * 100) / 100,
      marketAvgUnitPrice: Math.round(marketAvg * 100) / 100,
      bestAlternativeUnitPrice: Math.round(bestAlt * 100) / 100,
      bestAlternativeIsMarketplace: bestIsMarketplace,
      humanReason,
      confidence: overpaymentPct >= threshold * 2 ? 'high' : 'medium',
    };
  }
}

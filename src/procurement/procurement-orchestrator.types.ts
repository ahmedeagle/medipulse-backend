export interface P2PListingOption {
  listingId: string;
  sellerTenantId: string;
  sellerName: string;
  qty: number;
  unitPrice: number;
  sellerScore: number;
  rankScore: number;
}

export interface SupplierOptionWithScore {
  supplierTenantId: string;
  companyName: string;
  unitPrice: number;
  stock: number;
  currency: string;
  reliabilityScore: number;
  reliabilityLabel: string;
  avgDeliveryDays: number;
  /**
   * Delivery coverage relative to the buying pharmacy's region.
   * - true  → supplier explicitly serves the pharmacy's region, OR has no
   *           configured delivery zones (treated as "serves everywhere").
   * - false → supplier lists delivery zones that do NOT include the region.
   *           Such suppliers are filtered out of the plan and surfaced as
   *           rejected options ("لا يغطي منطقتك").
   */
  servesRegion: boolean;
  /** Quoted max lead time (days) from the supplier profile, when available. */
  deliveryDays: number | null;
  /** Minimum order amount (supplier currency) from the profile. */
  minOrderAmount: number;
}

export interface NormalizedSignalBundle {
  urgencyScore: number;
  financialRisk: 'low' | 'medium' | 'high';
  marketShortageRisk: boolean;
  marketAvailabilityRate: number;
  priceVolatility: number;
  qtyRequired: number;
  p2pAvailable: P2PListingOption[];
  supplierOptions: SupplierOptionWithScore[];
}

export interface ConflictResolution {
  rule: string;
  fired: boolean;
  outcome: string;
}

export interface RejectedOption {
  name: string;
  type: 'supplier' | 'p2p';
  rejectedReason: string;
}

export interface PlanSplit {
  source: 'p2p' | 'supplier';
  sourceId: string;
  sourceName: string;
  qty: number;
  unitPrice: number;
  reliabilityScore?: number;
  reason: string;
}

export interface ExplainabilityRecord {
  triggerEvent: 'demand_spike' | 'low_stock' | 'manual' | 'ai_recommendation' | 'cart_add';
  inputsSnapshot: {
    demandForecastUnits: number;
    currentStockUnits: number;
    financialHealthSummary: { cashRisk: boolean; creditUtilization: number };
    marketAvailabilityRate: number;
    p2pListingsCount: number;
    supplierOptionsCount: number;
    lastAvgUnitPrice: number;
  };
  computedSignals: {
    urgencyScore: number;
    financialRisk: 'low' | 'medium' | 'high';
    marketShortageRisk: boolean;
    priceVolatility: number;
  };
  conflictResolutions: ConflictResolution[];
  rejectedOptions: RejectedOption[];
  selectedPlanReason: string;
  financialImpact: {
    totalCost: number;
    savedVsHistoricalAvg: number;
    financialWarning: boolean;
    financialWarningReason?: string;
  };
  riskScore: number;
  confidence: number;
}

export interface FinancialStatus {
  creditAvailable: number;
  creditLimit: number;
  utilizationBeforePurchase: number;   // 0-100 %
  utilizationAfterPurchase: number;    // 0-100 %
  cashRisk: 'low' | 'medium' | 'high';
  recommendation: 'approve_now' | 'approve_with_caution' | 'delay_recommended';
}

/**
 * Counter-recommendation: when the orchestrator believes a non-trivial
 * delay would meaningfully improve the financial position WITHOUT
 * jeopardising stock coverage. Produced by a pure rule engine (no AI cost).
 *
 * `null` means "do not delay" — either there is no benefit or the situation
 * is too urgent.
 */
export interface DelayRecommendation {
  recommendedDelayDays: number;          // 1..14
  reasonCode:
    | 'cash_inflow_expected'              // POS revenue + AR will cover the cost
    | 'credit_reset_expected'             // supplier credit free-up incoming
    | 'low_urgency_high_finrisk'          // not urgent and finances are tight
    | 'price_drop_expected';              // historical volatility suggests waiting
  humanReason: string;                    // Arabic, ready for WhatsApp/UI render
  projectedInflow: number;                // total cash inflow over delay window
  daysToCoverCost: number | null;         // first day inflow covers totalCost
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Counter-recommendation: the plan's effective unit price is materially
 * above the open-market average for this product. Surfaces *before* the
 * pharmacy commits to the PO so they can renegotiate, switch supplier, or
 * pick up a P2P marketplace listing.
 *
 * `null` means "price is fair" — within `overpaymentThresholdPct` of market.
 */
export interface OverpaymentRecommendation {
  /** % above market average for the winning supplier in the plan. */
  overpaymentPct: number;
  /** The threshold that was breached (tenant-configurable, default 15). */
  thresholdPct: number;
  /** Effective unit price in the plan. */
  effectiveUnitPrice: number;
  /** Market average unit price across all suppliers (90-day window). */
  marketAvgUnitPrice: number;
  /** Lowest currently-active price (suppliers + marketplace) — the realistic alternative. */
  bestAlternativeUnitPrice: number | null;
  /** Whether the cheaper alternative is a P2P marketplace listing. */
  bestAlternativeIsMarketplace: boolean;
  humanReason: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface OrchestratorResult {
  productId: string;
  productName: string;
  qtyRequired: number;
  splits: PlanSplit[];
  totalCost: number;
  riskScore: number;
  confidence: number;
  insufficientSupply: boolean;
  financialStatus: FinancialStatus;
  /** Optional delay counter-recommendation; null means "act now". */
  delayRecommendation: DelayRecommendation | null;
  /** Optional overpayment warning; null means "price is fair". */
  overpaymentRecommendation: OverpaymentRecommendation | null;
  explainability: ExplainabilityRecord;
}

export interface SimulationConstraints {
  delayDays?: number;
  sourceFilter?: 'p2p_only' | 'supplier_only' | 'all';
  maxBudget?: number;
  excludeSupplierIds?: string[];
  triggerEvent?: ExplainabilityRecord['triggerEvent'];
  /**
   * Optional per-batch shared signal cache. The Ask-Agent flow calls
   * `generatePlan` for N items in parallel; without this, every call
   * independently re-fetches tenant-wide signals (financial wallet,
   * etc.) — N × redundant work.
   *
   * Pre-warm the cache once, then pass the same object into every
   * `generatePlan` call in the batch. Values may be undefined; the
   * orchestrator falls back to fetching on demand.
   */
  warmCache?: {
    /** Pre-fetched CreditWallet for the tenant (or null if none). */
    wallet?: unknown;
  };
}

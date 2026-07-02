import {
  Entity, PrimaryGeneratedColumn, Column,
  UpdateDateColumn, CreateDateColumn,
} from 'typeorm';

export interface ReceiptSettings {
  headerText?: string;
  footerText?: string;
  showLogo?: boolean;
  showAddress?: boolean;
  showTaxNumber?: boolean;
  showPhone?: boolean;
  language?: 'ar' | 'en';
  paperSize?: '80mm' | '58mm' | 'A4';
}

export interface LabelSettings {
  defaultSize?: 'small' | 'medium' | 'large' | 'custom';
  barcodeType?: 'CODE128' | 'CODE39' | 'EAN13';
  barcodeHeight?: number;
  showPharmacyName?: boolean;
  showProductName?: boolean;
  showPrice?: boolean;
  showBarcode?: boolean;
  showUom?: boolean;
  showExpiry?: boolean;
  showTax?: boolean;
}

export interface InventorySettings {
  disableExpiryForNewBatches?: boolean;
  reorderDays?: number;
  safetyStockPct?: number;
  expiryAlertDays?: number;
  reorderRecommendationType?: 'to_safety_stock' | 'to_max' | 'fixed_qty';
}

export interface AiAnalysisSettings {
  /** Prefer P2P over supplier when P2P saves ≥ p2pSavingsThreshold%. Default: true */
  preferP2POverSupplier?: boolean;
  /** Min % cheaper a P2P listing must be to beat supplier catalog. Default: 5 */
  p2pSavingsThreshold?: number;
  /** Max km to consider P2P sellers. Default: 10 */
  maxP2PDistanceKm?: number;
  /** Min seller reliability score 0–100. Default: 70 */
  minSellerReliabilityScore?: number;
  /** Run daily P2P-vs-supplier smart procurement analysis. Default: true */
  enableSmartProcurement?: boolean;
  /** Suggest listing near-expiry items on P2P marketplace. Default: true */
  enableExpiryProtection?: boolean;
  /** Detect dead stock and alert. Default: true */
  enableDeadStockAlerts?: boolean;
  /** Alert when inventory drops below minThreshold. Default: true */
  enableLowStockAlerts?: boolean;
  /**
   * Auto-approve orders under this amount in local currency.
   * null = always require human approval. Default: null (safety-first).
   */
  autoApproveOrdersUnderAmount?: number | null;
  /** Trigger re-analysis immediately when stock changes. Default: true */
  analyzeOnStockChange?: boolean;
  /** Demand forecast horizon in days. Default: 14 */
  forecastHorizonDays?: number;
  /**
   * Overpayment alert threshold — when `lastPricePaid > marketAvg × (1 + pct/100)`
   * the Price Intelligence page warns and the procurement orchestrator emits
   * an `OverpaymentRecommendation`. Default: 15 (industry-standard tolerance
   * for GCC + Egypt B2B pharma).
   */
  overpaymentThresholdPct?: number;

  // ── Dead-stock engine thresholds (configurable; fall back to code defaults) ──
  /** Classifier cutoff P(dead) to flag an item. Default: 0.70 */
  deadStockProbabilityThreshold?: number;
  /** Min urgency score (0–100) for the daily cron to create an approval task. Default: 70 */
  deadStockUrgencyTaskThreshold?: number;
  /** Urgency score at/above which the deeper discount applies. Default: 90 */
  deadStockHighUrgencyScore?: number;
  /** Suggested P2P clearance discount for normal dead stock. Default: 25 */
  deadStockDiscountPct?: number;
  /** Suggested P2P clearance discount for high-urgency dead stock. Default: 40 */
  deadStockHighDiscountPct?: number;
  /** Weeks without movement before a markdown is recommended. Default: 12 */
  deadStockDormancyWeeksMarkdown?: number;
  /** Weeks without movement (with high locked value) before supplier-return. Default: 16 */
  deadStockDormancyWeeksReturn?: number;
}

export interface NotificationSettings {
  enableLowStockAlerts?:          boolean;
  enableExpiryAlerts?:            boolean;
  enableDeadStockAlerts?:         boolean;
  enableP2POrderAlerts?:          boolean;
  enableSmartProcurementAlerts?:  boolean;
  enableClearanceAlerts?:         boolean;
  enablePosIntegrityAlerts?:      boolean;
  enableMorningBriefing?:         boolean;
  enableOverpaymentAlerts?:       boolean;
}

/**
 * VAT/Tax behaviour — varies by jurisdiction.
 *
 *  - 'tax_on_net'   → invoice-level discount reduces the taxable base; tax is
 *                     recomputed on (subtotal − totalDiscount). This matches
 *                     Egyptian VAT Law no. 67/2016 (art. 11) and the GCC VAT
 *                     Framework Agreement default. Strongly recommended for
 *                     pharmacies operating in EG / KSA / UAE / Oman post-2018.
 *
 *  - 'tax_on_gross' → invoice-level discount is treated as a commercial
 *                     rebate after VAT is owed; tax stays on the pre-discount
 *                     base. Use only when your accountant has explicitly
 *                     advised this (some legacy KSA contracts, trade-discount
 *                     edge cases).
 */
export interface TaxSettings {
  vatCalculationMode?: 'tax_on_net' | 'tax_on_gross';
  /**
   * VAT rate applied to purchase invoices. Accepts a fraction (0.14) or a
   * percentage (14) — the billing-context resolver normalizes both. When
   * unset, a jurisdiction default is derived from country/currency
   * (EG 14%, KSA 15%, UAE/Oman 5%, Bahrain 10%, Kuwait/Qatar 0%).
   */
  vatRate?: number;
  /** Tax-registration number printed on invoices/receipts. */
  taxRegistrationNumber?: string;
}

@Entity('pharmacy_settings')
export class PharmacySettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  pharmacyTenantId: string;

  // ── General ─────────────────────────────────────────────────────────────────
  @Column({ default: 'ar' })
  language: string;

  @Column({ default: 'EGP' })
  currency: string;

  @Column({ default: 'Africa/Cairo' })
  timezone: string;

  @Column({ default: 'YYYY-MM-DD' })
  dateFormat: string;

  @Column({ default: '12h' })
  timeFormat: string;

  @Column({ default: true })
  taxEnabled: boolean;

  // ── Pharmacy profile ─────────────────────────────────────────────────────────
  @Column({ nullable: true })
  pharmacyNameAr: string;

  @Column({ nullable: true })
  pharmacyNameEn: string;

  @Column({ nullable: true })
  licenseNumber: string;

  @Column({ default: 'retail' })
  pharmacyType: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  contactEmail: string;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  region: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  gpsLocation: string;

  @Column({ nullable: true })
  logoUrl: string;

  // ── Receipt settings ─────────────────────────────────────────────────────────
  @Column({ type: 'jsonb', default: '{}' })
  receiptSettings: ReceiptSettings;

  // ── Label/sticker settings ───────────────────────────────────────────────────
  @Column({ type: 'jsonb', default: '{}' })
  labelSettings: LabelSettings;

  // ── Inventory settings ───────────────────────────────────────────────────────
  @Column({ type: 'jsonb', default: '{}' })
  inventorySettings: InventorySettings;

  // ── AI smart-analyzer settings ───────────────────────────────────────────────
  @Column({ type: 'jsonb', default: '{}' })
  aiAnalysisSettings: AiAnalysisSettings;

  // ── Notification preferences ─────────────────────────────────────────────
  @Column({ type: 'jsonb', nullable: true, default: '{}' })
  notificationSettings: NotificationSettings;

  // ── Tax / VAT preferences (multi-jurisdiction) ───────────────────────────
  @Column({ type: 'jsonb', default: '{}' })
  taxSettings: TaxSettings;

  // ── P2P Network ──────────────────────────────────────────────────────────────
  /** When true, other pharmacies can discover this pharmacy's live inventory via "Need Now" search (availability only — no prices exposed). */
  @Column({ default: false })
  allowInventoryDiscovery: boolean;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

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

  // ── P2P Network ──────────────────────────────────────────────────────────────
  /** When true, other pharmacies can discover this pharmacy's live inventory via "Need Now" search (availability only — no prices exposed). */
  @Column({ default: false })
  allowInventoryDiscovery: boolean;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

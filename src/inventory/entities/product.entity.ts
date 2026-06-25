import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

@Entity('products')
@Index(['canonicalName', 'strength', 'dosageForm'])  // normalization lookup
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Arabic display name — shown in Arabic UI */
  @Column({ type: 'varchar', length: 255, nullable: true })
  nameAr: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  genericName: string;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({ type: 'varchar', length: 50 })
  unit: string;

  /** Internal SKU / product code used by the pharmacy */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sku: string;

  @Column({ type: 'varchar', length: 100, nullable: true, unique: true })
  barcode: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // ── Normalization fields (Phase 1.5 Month 2) ──────────────────────────────

  /** Lowercased, stripped canonical name — e.g., "amoxicillin" */
  @Column({ type: 'varchar', length: 255, nullable: true })
  canonicalName: string;

  /** Active pharmaceutical ingredient — e.g., "amoxicillin trihydrate" */
  @Column({ type: 'varchar', length: 255, nullable: true })
  activeIngredient: string;

  /** Dosage strength — e.g., "500mg", "250mg/5ml" */
  @Column({ type: 'varchar', length: 50, nullable: true })
  strength: string;

  /** Dosage form — tablet | capsule | syrup | injection | cream | drops | other */
  @Column({ type: 'varchar', length: 50, nullable: true })
  dosageForm: string;

  /** WHO ATC classification code — e.g., "J01CA04" */
  @Column({ type: 'varchar', length: 20, nullable: true })
  atcCode: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  manufacturer: string;

  // ── Country Registration Numbers ──────────────────────────────────────────
  // Universal identifier: atcCode (WHO ATC). Country codes layered on top.

  /** Saudi Arabia — SFDA registration number */
  @Column({ type: 'varchar', length: 50, nullable: true })
  sfdaRegistration: string;

  /** Egypt — EDA (Egyptian Drug Authority) registration number */
  @Column({ type: 'varchar', length: 50, nullable: true })
  edaRegistration: string;

  /** UAE — MOHAP registration number */
  @Column({ type: 'varchar', length: 50, nullable: true })
  mohapRegistration: string;

  /** Jordan — JFDA registration number */
  @Column({ type: 'varchar', length: 50, nullable: true })
  jfdaRegistration: string;

  /** True = this is the canonical master product. False = this is a named variant/alias. */
  @Column({ type: 'boolean', default: true })
  isCanonical: boolean;

  /** Points to the canonical product when isCanonical = false */
  @Column({ type: 'uuid', nullable: true })
  canonicalProductId: string;

  @ManyToOne(() => Product, { nullable: true, eager: false })
  @JoinColumn({ name: 'canonicalProductId' })
  canonicalProduct: Product;

  /** True when a supplier catalog item references this product but it hasn't been mapped yet */
  @Column({ type: 'boolean', default: false })
  requiresMapping: boolean;

  // ── Saudi MOH / SFDA Regulatory Fields ───────────────────────────────────

  /**
   * Controlled substance schedule per Saudi Arabia Narcotics Control Law.
   * null = not controlled
   * 1 = Schedule I (morphine, fentanyl, oxycodone) — strictest controls
   * 2 = Schedule II (codeine <200mg, tramadol) — high controls
   * 3 = Schedule III (buprenorphine, benzodiazepines) — moderate controls
   * 4 = Schedule IV (low-potential abuse)
   *
   * Controlled substances require:
   *   - Pharmacist sign-off on every order (enforced in OrdersService)
   *   - Quantity reconciliation on returns
   *   - Special storage and disposal records
   *   - SFDA controlled substances reporting
   */
  @Column({ type: 'int', nullable: true })
  controlledSubstanceSchedule: 1 | 2 | 3 | 4 | null;

  /**
   * Whether this product requires cold chain (2–8°C storage).
   * Includes vaccines, biologics, some antibiotics.
   * Flags delivery receipt for temperature verification requirement.
   */
  @Column({ type: 'boolean', default: false })
  requiresColdChain: boolean;

  /**
   * Minimum storage temperature in °C (for cold chain products).
   * Default 2 for most refrigerated drugs.
   */
  @Column({ type: 'int', nullable: true })
  storageMinTempC: number;

  /**
   * Maximum storage temperature in °C.
   * Default 8 for refrigerated, 25 for room temperature.
   */
  @Column({ type: 'int', nullable: true })
  storageMaxTempC: number;

  /**
   * Whether this product may have clinically significant drug-drug interactions.
   * When true, the order flow should warn the pharmacist to verify patient's
   * current medication list before dispensing.
   *
   * Full DDI checking requires integration with a clinical database (e.g. RxNorm).
   * This flag is a manual marker until that integration is built.
   */
  @Column({ type: 'boolean', default: false })
  hasDrugInteractionRisk: boolean;

  /**
   * Free-text notes about known interactions or special dispensing requirements.
   * Example: "Do not combine with MAO inhibitors. Narrow therapeutic index."
   */
  @Column({ type: 'text', nullable: true })
  drugInteractionNotes: string;

  /**
   * Requires a valid prescription to dispense.
   * Rx drugs cannot be sold OTC per Saudi pharmacy law.
   */
  @Column({ type: 'boolean', default: false })
  requiresPrescription: boolean;

  // ── Pricing & Tax ─────────────────────────────────────────────────────────

  /** VAT / tax rate percentage. 0 = tax-exempt. Applied on POS receipt and purchase invoice lines. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate: number;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** False = product is discontinued — hidden from POS & purchase order searches. */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  // ── Behaviour Toggles (Aumet parity) ─────────────────────────────────────

  /** When true, product cannot be sold at POS (internal-use only). */
  @Column({ type: 'boolean', default: false })
  disablePOSSale: boolean;

  /** When true, product is blocked from purchase orders. */
  @Column({ type: 'boolean', default: false })
  disablePurchase: boolean;

  /** Whether this product is eligible for customer return/refund. */
  @Column({ type: 'boolean', default: true })
  returnable: boolean;

  /** Whether a discount can be applied at POS checkout. */
  @Column({ type: 'boolean', default: true })
  discountAllowed: boolean;

  // ── F-08: Product image ────────────────────────────────────────────────────

  /** Public URL of the product image (JPG/PNG, max 2MB). Stored in /uploads/products/. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  imageUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany('InventoryItem', 'product')
  inventoryItems: any[];

  @OneToMany('SupplierCatalogItem', 'product')
  supplierCatalogItems: any[];
}

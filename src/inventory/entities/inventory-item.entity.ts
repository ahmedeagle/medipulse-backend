import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../auth/entities/tenant.entity';
import { Product } from './product.entity';

@Entity('inventory_items')
@Index(['pharmacyTenantId', 'deletedAt'])   // primary access pattern: all items for a pharmacy
@Index(['pharmacyTenantId', 'productId'])   // deduplication check on order delivery
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @ManyToOne(() => Tenant, { eager: false })
  @JoinColumn({ name: 'pharmacyTenantId' })
  pharmacyTenant: Tenant;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, (product) => product.inventoryItems, { eager: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @Column({ type: 'int', default: 10 })
  minThreshold: number;

  @Column({ type: 'date', nullable: true })
  expiryDate: Date;

  /** Lot / batch number from the supplier delivery */
  @Column({ type: 'varchar', length: 100, nullable: true })
  batchNumber: string;

  /** Physical storage location, e.g. "Main Warehouse", "Cold Storage" */
  @Column({ type: 'varchar', length: 100, nullable: true, default: 'Main Warehouse' })
  location: string;

  /** Purchase / cost price per unit (SAR) */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  costPrice: number;

  /** Retail selling price per unit (SAR) */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  sellingPrice: number;

  // ── Catalog linking (Phase 1) ───────────────────────────────────────────────
  /**
   * Status of this item's link to the central catalog (Product table).
   *  - linked    : confident catalog match, master fields are sourced from catalog
   *  - unlinked  : no catalog match yet (eligible for a CatalogRequest)
   *  - suggested : matching engine found a probable match — awaits user confirm
   *  - pending   : a CatalogRequest has been submitted and is under review
   */
  @Column({ type: 'varchar', length: 20, default: 'unlinked' })
  linkStatus: 'linked' | 'unlinked' | 'suggested' | 'pending';

  /** Confidence score 0..100 for the current catalog match. */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  matchScore: number | null;

  /**
   * Structured explanation of why we linked this item to its catalog product —
   * e.g. { signals: ['barcode_exact','manufacturer_match'], details: {...} }.
   */
  @Column({ type: 'jsonb', nullable: true })
  matchExplanation: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  lastLinkedAt: Date | null;

  /**
   * If this row was created by a bulk-import batch, the batch id that produced
   * it. Null for items added through the manual UI. Used for audit + so the
   * frontend can link "view items from this upload" from the import history.
   */
  @Column({ type: 'uuid', nullable: true })
  importBatchId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

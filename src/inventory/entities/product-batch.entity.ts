import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type BatchStatus = 'active' | 'quarantined' | 'recalled' | 'expired' | 'returned' | 'depleted';

/**
 * Pharmaceutical batch/lot tracking — SFDA mandatory requirement.
 *
 * Every product received must be traceable to its batch number.
 * On recall: status → recalled, all inventory items with this batch are flagged.
 * On expiry: status → expired, pharmacy receives advance alerts (90/30/7 days).
 *
 * This entity is the foundation for:
 *   - SFDA audit compliance (full supply chain traceability)
 *   - Recall execution (which pharmacies hold this batch?)
 *   - FEFO dispensing (first-expiry-first-out)
 *   - Dead stock financial impact (costPerUnit × quantity on hand)
 */
@Entity('product_batches')
@Index(['productId', 'batchNumber'])
@Index(['supplierTenantId', 'productId'])
@Index(['expiryDate', 'status'])
@Index(['inventoryItemId', 'status'])
@Index(['pharmacyTenantId', 'status'])
export class ProductBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'uuid', nullable: true })
  supplierTenantId: string;

  /** Pharmacy that physically holds this batch — null for catalogue-only rows. */
  @Column({ type: 'uuid', nullable: true })
  pharmacyTenantId: string;

  /** Linked inventory item (per-pharmacy product row). */
  @Column({ type: 'uuid', nullable: true })
  inventoryItemId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  batchNumber: string;

  @Column({ type: 'date', nullable: true })
  manufacturingDate: Date;

  @Column({ type: 'date', nullable: true })
  expiryDate: Date;

  /** Units currently on hand from this lot. Decreases as the lot is consumed. */
  @Column({ type: 'int', default: 0 })
  quantity: number;

  /** Original received quantity — immutable, used for audit / FIFO reports. */
  @Column({ type: 'int', default: 0 })
  receivedQuantity: number;

  /** Purchase cost per unit — used for dead stock financial impact calculation */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  costPerUnit: number;

  /** Retail selling price per unit (per-lot — supports promo / new-pricing batches). */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  sellingPrice: number;

  @Column({ type: 'varchar', length: 3, default: 'SAR' })
  currency: string;

  @Column({ type: 'varchar', length: 100, nullable: true, default: 'Main Warehouse' })
  location: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: BatchStatus;

  /** Free-form note attached at receipt time (visible in batch history). */
  @Column({ type: 'text', nullable: true })
  notes: string;

  /** User (sub) who recorded this batch — for audit trail. */
  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string;

  // ── Quarantine ────────────────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  quarantineReason: string;

  @Column({ type: 'timestamp', nullable: true })
  quarantinedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  quarantinedByUserId: string;

  // ── Recall ────────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 100, nullable: true })
  recallReferenceNumber: string;   // SFDA recall reference

  @Column({ type: 'timestamp', nullable: true })
  recallIssuedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  recallId: string;               // FK to ProductRecall entity

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

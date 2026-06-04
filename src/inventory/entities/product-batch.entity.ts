import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type BatchStatus = 'active' | 'quarantined' | 'recalled' | 'expired' | 'returned';

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
 *   - FIFO dispensing (oldest batch consumed first)
 *   - Dead stock financial impact (costPerUnit × quantity on hand)
 */
@Entity('product_batches')
@Index(['productId', 'batchNumber'])
@Index(['supplierTenantId', 'productId'])
@Index(['expiryDate', 'status'])
export class ProductBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'uuid', nullable: true })
  supplierTenantId: string;

  @Column({ type: 'varchar', length: 100 })
  batchNumber: string;

  @Column({ type: 'date', nullable: true })
  manufacturingDate: Date;

  @Column({ type: 'date' })
  expiryDate: Date;

  /** Purchase cost per unit — used for dead stock financial impact calculation */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  costPerUnit: number;

  @Column({ type: 'varchar', length: 3, default: 'SAR' })
  currency: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: BatchStatus;

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
}

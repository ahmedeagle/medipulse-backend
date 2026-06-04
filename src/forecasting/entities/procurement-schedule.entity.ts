import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Optimal reorder schedule per product per pharmacy.
 * Computed from EOQ + safety stock + supplier lead time.
 *
 * Key insight: instead of "order now because you're low" (reactive),
 * this says "order by Thursday to not run out by the 15th" (proactive).
 */
@Entity('procurement_schedules')
@Index(['tenantId', 'productId'], { unique: true })
@Index(['tenantId', 'reorderByDate'])
export class ProcurementSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  productId: string;

  // ── EOQ Parameters ───────────────────────────────────────────────────────

  /** Economic Order Quantity — optimal units per order */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  eoqQty: number;

  /** Safety stock — buffer against demand/supply variability */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  safetyStockQty: number;

  /** Reorder Point — trigger reorder when stock drops to this level */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  reorderPoint: number;

  /** Dynamic lead time used (days) — from supplier reliability score */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 14 })
  effectiveLeadTimeDays: number;

  /** Service level used (0.0–1.0) — default 0.95 (95%) */
  @Column({ type: 'decimal', precision: 4, scale: 3, default: 0.95 })
  serviceLevel: number;

  // ── Schedule ─────────────────────────────────────────────────────────────

  /** The latest date to place the order and still receive before stockout */
  @Column({ type: 'date', nullable: true })
  reorderByDate: Date;

  /** Predicted stockout date if no action taken */
  @Column({ type: 'date', nullable: true })
  predictedStockoutDate: Date;

  /** Days buffer remaining before action is needed */
  @Column({ type: 'int', nullable: true })
  daysUntilReorderNeeded: number;

  /** Recommended preferred supplier for this product */
  @Column({ type: 'uuid', nullable: true })
  recommendedSupplierTenantId: string;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

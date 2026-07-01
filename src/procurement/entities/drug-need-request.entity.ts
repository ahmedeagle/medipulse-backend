import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export type NeedUrgency = 'normal' | 'urgent' | 'critical';
export type NeedStatus = 'open' | 'sourced' | 'fulfilled' | 'cancelled' | 'expired';

/**
 * drug_need_requests — pharmacy-initiated DEMAND signal ("أحتاج دواء").
 *
 * P2P historically captured only SUPPLY (what pharmacies sell). This table captures
 * the missing half — what a pharmacy NEEDS right now — and is the single source of
 * truth that powers:
 *   1. On-demand sourcing: each need is run through the EXISTING ProcurementOrchestrator
 *      (distributors + nearby pharmacies, best price, multi-supplier split) and the
 *      result is snapshotted in `resultSnapshot`.
 *   2. Shortage Radar (future): COUNT(distinct pharmacy) of OPEN needs per product per
 *      region → real-time shortage signal.
 *   3. Notify-when-available: re-source open needs and alert the pharmacy.
 *
 * Privacy: any future aggregation is product-level only; an individual pharmacy's need
 * is never exposed to other tenants.
 */
@Entity('drug_need_requests')
@Index(['pharmacyTenantId', 'status'])
@Index(['productId', 'status'])
export class DrugNeedRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  /** Resolved canonical product. Null when the typed name matched no catalog product. */
  @Column({ type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ type: 'varchar', length: 255 })
  productName: string;

  @Column({ type: 'int', default: 1 })
  requestedQty: number;

  /** Pharmacy region at request time — used by the (future) regional shortage radar. */
  @Column({ type: 'varchar', length: 12, default: 'normal' })
  urgency: NeedUrgency;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: NeedStatus;

  @Column({ type: 'varchar', length: 120, nullable: true })
  region: string | null;

  /** How many viable sources (suppliers + P2P) the engine found at request time. */
  @Column({ type: 'int', default: 0 })
  sourceOptionsCount: number;

  /** Compact summary of the orchestrator plan (splits, best price, savings). */
  @Column({ type: 'jsonb', nullable: true })
  resultSnapshot: Record<string, any> | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

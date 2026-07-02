import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index, Unique,
} from 'typeorm';

export type RecoveryEventType =
  | 'purchase_saving'      // cheaper procurement vs historical average (realized at PO)
  | 'p2p_saving'           // bought via P2P below market (realized at order complete)
  | 'expiry_avoided'       // near-expiry stock listed for recovery (projected → realized on sale)
  | 'deadstock_recovered'  // dead stock listed/sold for recovery (projected → realized on sale)
  | 'stockout_avoided'     // reorder executed before stockout (projected)
  | 'return_recovery';     // value recovered via supplier return

export type RecoveryEventStatus = 'projected' | 'realized' | 'lost' | 'expired';
export type RecoverySourceType = 'approval' | 'order' | 'cron' | 'agent' | 'return';

/**
 * ai_recovery_events — the persisted "Financial Impact Measurement" layer.
 *
 * Every time the system prevents a loss or captures a saving, ONE durable row is
 * written here. This is the single source of truth for ROI/impact metrics, so the
 * AI Center dashboard no longer computes savings on-the-fly from approval JSON.
 *
 * Design for scale + correctness:
 *   • Idempotent: UNIQUE (sourceType, sourceId, type) + ON CONFLICT DO NOTHING means
 *     a cron/executor that fires twice never double-counts. (Rows without a sourceId
 *     are treated as distinct — NULLs don't collide in a Postgres unique index.)
 *   • Honest: `status` separates 'realized' (money actually captured, e.g. a PO placed
 *     at a lower price) from 'projected' (value at risk now being recovered, e.g. a
 *     near-expiry listing not yet sold). Dashboards sum realized and pipeline separately
 *     so ROI is never inflated.
 *   • Fast aggregation: composite indexes on (tenant, createdAt) and (tenant, type,
 *     createdAt) cover the grouped time-range SUM used by the report — no table scan.
 */
@Entity('ai_recovery_events')
@Index('idx_recovery_tenant_created', ['pharmacyTenantId', 'createdAt'])
@Index('idx_recovery_tenant_type_created', ['pharmacyTenantId', 'type', 'createdAt'])
@Unique('uq_recovery_source', ['sourceType', 'sourceId', 'type'])
export class RecoveryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'varchar', length: 32 })
  type: RecoveryEventType;

  @Column({ type: 'varchar', length: 16, default: 'realized' })
  status: RecoveryEventStatus;

  /** Realized money captured (EGP). 0 for purely projected events until realized. */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  amountEgp: number;

  /** Value at risk / expected recovery at detection time (EGP). */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  expectedValueEgp: number | null;

  /** Actual realized value once the outcome closes (e.g. listing sold). */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  realizedValueEgp: number | null;

  @Column({ type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ type: 'varchar', length: 24 })
  sourceType: RecoverySourceType;

  /** approvalId / orderId / etc. — the idempotency key together with (sourceType, type). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceId: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  subjectType: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

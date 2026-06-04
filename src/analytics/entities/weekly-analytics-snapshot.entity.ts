import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * Pre-aggregated weekly analytics per pharmacy tenant.
 * Computed every Sunday at 4am by AnalyticsSnapshotService.
 *
 * Dashboard queries hit this table — NEVER the operational tables.
 * This is the correct way to serve analytics at scale without impacting
 * order/inventory read performance.
 */
@Entity('weekly_analytics_snapshots')
@Index(['tenantId', 'weekStart'], { unique: true })
export class WeeklyAnalyticsSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /** Monday of the week this snapshot covers */
  @Column({ type: 'date' })
  weekStart: Date;

  @Column({ type: 'int', default: 0 })
  totalOrders: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalSpend: number;

  @Column({ type: 'varchar', length: 10, default: 'SAR' })
  currency: string;

  @Column({ type: 'int', default: 0 })
  recommendationsGenerated: number;

  /** How many HIGH-risk recommendations resulted in an actual order */
  @Column({ type: 'int', default: 0 })
  recommendationsActedOn: number;

  /** 0.0–1.0 — acted_on / generated */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  recommendationConversionRate: number;

  /** Stockout events detected (quantity hit 0) */
  @Column({ type: 'int', default: 0 })
  stockoutEvents: number;

  /** Product ID with highest order volume this week */
  @Column({ type: 'uuid', nullable: true })
  topProductId: string;

  @Column({ type: 'timestamp' })
  computedAt: Date;
}

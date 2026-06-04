import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Regional demand multipliers per product per month.
 * Seeded manually by system admin for known seasonal patterns.
 * Will be auto-computed from aggregated (anonymized) order patterns later.
 */
@Entity('regional_demand_signals')
@Index(['productId', 'region', 'month'], { unique: true })
export class RegionalDemandSignal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  /** City or region identifier, e.g. "riyadh", "jeddah", "ksa_north" */
  @Column({ type: 'varchar', length: 100 })
  region: string;

  /** Month number 1–12 */
  @Column({ type: 'int' })
  month: number;

  /** Demand multiplier relative to baseline, e.g. 1.25 = +25% */
  @Column({ type: 'decimal', precision: 5, scale: 3, default: 1.0 })
  demandMultiplier: number;

  /** 'manual' = set by admin, 'computed' = derived from aggregated order data */
  @Column({ type: 'varchar', length: 20, default: 'manual' })
  source: 'manual' | 'computed';

  @Column({ type: 'text', nullable: true })
  notes: string;
}

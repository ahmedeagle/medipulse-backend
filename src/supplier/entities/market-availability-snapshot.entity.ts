import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Stores point-in-time market availability for a product across the supplier network.
 * Computed by MarketAvailabilityService (daily cron + on-demand).
 * Used by ProcurementOrchestrator Layer 1 as an active signal.
 */
@Entity('market_availability_snapshots')
@Index(['productId', 'recordedAt'])     // time-series query: latest snapshot per product
@Index(['availabilityRate', 'recordedAt']) // alert queries: find all at-risk products
export class MarketAvailabilitySnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  /** 0–1: activeSuppliers / totalSuppliers */
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  availabilityRate: number;

  @Column({ type: 'int' })
  activeSuppliers: number;

  @Column({ type: 'int' })
  totalSuppliers: number;

  /** Lowest unit price found across active suppliers at this snapshot moment */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  lowestActivePrice: number | null;

  @CreateDateColumn()
  recordedAt: Date;
}

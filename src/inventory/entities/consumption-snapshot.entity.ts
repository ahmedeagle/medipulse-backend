import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Weekly aggregate of product consumption per pharmacy.
 * Computed every Sunday from delivered orders.
 * Used to classify products as fast/slow/dead movers and detect spikes.
 */
@Entity('consumption_snapshots')
@Index(['tenantId', 'productId', 'weekStart'])
@Index(['tenantId', 'productId'])
export class ConsumptionSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  productId: string;

  /** Monday of the week this snapshot covers */
  @Column({ type: 'date' })
  weekStart: Date;

  @Column({ type: 'int', default: 0 })
  quantityConsumed: number;

  @Column({ type: 'int', default: 0 })
  ordersPlaced: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  avgOrderSize: number;

  /** fast_mover | slow_mover | dead_stock | normal */
  @Column({ type: 'varchar', length: 20, default: 'normal' })
  velocityLabel: string;
}

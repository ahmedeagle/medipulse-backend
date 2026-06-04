import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Immutable record of every supplier price change.
 * Written whenever a SupplierStockChangedEvent fires with a different price.
 *
 * Enables:
 *   - Price trend analysis per product per supplier
 *   - Detecting price volatility (useful for procurement timing)
 *   - Historical cost basis for spend analytics
 */
@Entity('price_snapshots')
@Index(['supplierTenantId', 'productId', 'recordedAt'])
@Index(['productId', 'recordedAt'])
export class PriceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  supplierTenantId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'varchar', length: 10, default: 'SAR' })
  currency: string;

  /** Stock level at the time of the price change — context for the pricing decision */
  @Column({ type: 'int', nullable: true })
  stockAtTime: number;

  @CreateDateColumn()
  recordedAt: Date;
}

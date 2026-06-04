import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * Per-supplier, per-product reliability scores.
 * Recalculated daily by SupplierReliabilityService.
 * Fed into the rules engine to prefer reliable suppliers in recommendations.
 */
@Entity('supplier_reliability_scores')
@Index(['supplierTenantId', 'productId'], { unique: true })
@Index(['supplierTenantId', 'overallScore'])
export class SupplierReliabilityScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  supplierTenantId: string;

  /** Null = score applies to the whole supplier (not product-specific) */
  @Column({ type: 'uuid', nullable: true })
  productId: string;

  /** % of orders accepted (vs cancelled by supplier) — 0.0–1.0 */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  acceptanceRate: number;

  /** Average days from ACCEPTED to DELIVERED */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  avgDeliveryDays: number;

  /** % of orders fulfilled completely (not partially) — 0.0–1.0 */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  fulfillmentRate: number;

  /** Orders sampled for this calculation */
  @Column({ type: 'int', default: 0 })
  sampleSize: number;

  /** Composite 0–100 score: (acceptanceRate×40 + fulfillmentRate×40 + deliverySpeed×20) */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  overallScore: number;

  /** 'high' ≥70, 'medium' 40–70, 'low' <40 */
  @Column({ type: 'varchar', length: 10, default: 'low' })
  reliabilityLabel: string;

  @Column({ type: 'timestamp' })
  lastCalculatedAt: Date;
}

import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type TrustLevel = 'bronze' | 'silver' | 'gold' | 'platinum';

/**
 * Trust level thresholds:
 *   platinum : overallScore >= 90 AND sampleSize >= 50
 *   gold     : overallScore >= 75 AND sampleSize >= 20
 *   silver   : overallScore >= 55 AND sampleSize >= 5
 *   bronze   : everything else (at least 1 completed order)
 */
@Entity('seller_reliability_scores')
@Index(['pharmacyTenantId'], { unique: true })
@Index(['overallScore'])
export class SellerReliabilityScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  pharmacyTenantId: string;

  /** % of orders accepted (vs rejected/cancelled) — 0.0–1.0 */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  acceptanceRate: number;

  /** Average minutes from order creation to seller response */
  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  avgResponseMinutes: number;

  /** % of accepted orders fulfilled completely — 0.0–1.0 */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  fulfillmentRate: number;

  /** Orders sampled in the last 90 days */
  @Column({ type: 'int', default: 0 })
  sampleSize: number;

  /** Composite 0–100: acceptanceRate×50 + responseSpeed×30 + fulfillmentRate×20 */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  overallScore: number;

  /** 'high' ≥70, 'medium' 40–70, 'low' <40 */
  @Column({ type: 'varchar', length: 10, default: 'low' })
  label: string;

  @Column({ type: 'varchar', length: 10, default: 'bronze' })
  trustLevel: TrustLevel;

  @Column({ type: 'timestamp', nullable: true })
  lastCalculatedAt: Date;
}

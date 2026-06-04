import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type DraftStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'converted_to_order'
  | 'expired';

export type UrgencyLevel = 'critical' | 'high' | 'medium';

/**
 * Auto-generated draft procurement orders.
 * Created automatically when a HIGH-risk AI recommendation fires.
 * Pharmacy admin reviews and one-click approves → becomes a real Order.
 *
 * Design intent: admin should only have to *approve* or *reject*, never build from scratch.
 */
@Entity('procurement_drafts')
@Index(['pharmacyTenantId', 'status', 'urgencyLevel'])  // queue view query
@Index(['recommendationId'])
export class ProcurementDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  /** Best-matching supplier selected by reliability + price */
  @Column({ type: 'uuid' })
  supplierTenantId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  suggestedQuantity: number;

  /** Unit price at time of draft creation (from supplier catalog) */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitPrice: number;

  @Column({ type: 'varchar', length: 10, default: 'SAR' })
  currency: string;

  @Column({ type: 'varchar', length: 10 })
  urgencyLevel: UrgencyLevel;

  /** Links back to the AI recommendation that triggered this draft */
  @Column({ type: 'uuid', nullable: true })
  recommendationId: string;

  @Column({ type: 'varchar', length: 25, default: 'pending_review' })
  status: DraftStatus;

  /** orderId once draft is converted to a real order */
  @Column({ type: 'uuid', nullable: true })
  convertedOrderId: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  /** Drafts auto-expire after 48 hours if not acted on */
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

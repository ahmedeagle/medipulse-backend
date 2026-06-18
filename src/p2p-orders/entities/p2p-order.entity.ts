import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type P2pOrderStatus =
  | 'pending'
  | 'accepted'
  | 'shipped'
  | 'rejected'
  | 'completed'
  | 'cancelled';

export type P2pUrgencyLevel = 'normal' | 'urgent' | 'critical';

@Entity('p2p_orders')
// ── Query-pattern indexes ──────────────────────────────────────────────────
// Buyer/seller list sorted by newest: covers WHERE + ORDER BY in one scan
@Index(['buyerTenantId', 'createdAt'])
@Index(['sellerTenantId', 'createdAt'])
// Status-filtered list: covers role+status WHERE + ORDER BY in one scan
@Index(['buyerTenantId', 'status', 'createdAt'])
@Index(['sellerTenantId', 'status', 'createdAt'])
// Listing lookup + reservation cron (WHERE listingId + status = 'accepted')
@Index(['listingId', 'status'])
// Urgency dashboard (Phase 2) and critical-order alerts
@Index(['urgencyLevel', 'status', 'createdAt'])
export class P2pOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  buyerTenantId: string;

  @Column({ type: 'uuid' })
  sellerTenantId: string;

  @Column({ type: 'uuid' })
  listingId: string;

  @Column({ type: 'int' })
  requestedQty: number;

  /** Price snapshot at order creation time — frozen, not affected by listing edits */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  agreedPrice: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: P2pOrderStatus;

  @Column({ type: 'varchar', length: 10, default: 'normal' })
  urgencyLevel: P2pUrgencyLevel;

  /** Set on accept for urgent-mode time-limited reservations (Phase 2) */
  @Column({ type: 'timestamp', nullable: true })
  reservationExpiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  expectedDeliveryAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  shippedAt: Date;

  @Column({ type: 'text', nullable: true })
  deliveryNote: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @Column({ type: 'timestamp', nullable: true })
  respondedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

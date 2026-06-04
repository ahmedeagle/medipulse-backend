import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { Tenant } from '../../auth/entities/tenant.entity';
import { OrderItem } from './order-item.entity';

export interface OrderHistoryEntry {
  from:          string;
  to:            string;
  changedBy:     string;
  changedByRole: string;
  at:            string;
  reason?:       string;
}

const SAR_VAT_RATE = 0.15;

@Entity('orders')
@Index(['pharmacyTenantId', 'status'])
@Index(['supplierTenantId', 'status'])
@Index(['pharmacyTenantId', 'createdAt'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @ManyToOne(() => Tenant, { eager: false })
  @JoinColumn({ name: 'pharmacyTenantId' })
  pharmacyTenant: Tenant;

  @Column({ type: 'uuid' })
  supplierTenantId: string;

  @ManyToOne(() => Tenant, { eager: false })
  @JoinColumn({ name: 'supplierTenantId' })
  supplierTenant: Tenant;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.SUBMITTED })
  status: OrderStatus;

  // ── ZATCA-compliant financials ─────────────────────────────────────────────

  @Column({ type: 'varchar', length: 3, default: 'SAR' })
  currency: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotalAmount: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: SAR_VAT_RATE })
  vatRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  vatAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalAmount: number;

  // ── Approval workflow ──────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  approvalThresholdSar: number;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId: string;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date;

  // ── Supplier communication ─────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @Column({ type: 'text', nullable: true })
  counterOfferNotes: string;

  // ── Dispute & hold ─────────────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  disputeReason: string;

  @Column({ type: 'timestamp', nullable: true })
  disputeOpenedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  disputeResolvedAt: Date;

  @Column({ type: 'text', nullable: true })
  onHoldReason: string;

  // ── Delivery confirmation ──────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 500, nullable: true })
  deliveryProofUrl: string;

  @Column({ type: 'timestamp', nullable: true })
  deliveryTimestamp: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipientName: string;

  // ── Immutable audit trail ─────────────────────────────────────────────────

  @Column({ type: 'jsonb', default: [] })
  changeHistory: OrderHistoryEntry[];

  // Use class reference (not string) to avoid TypeORM metadata resolution errors
  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

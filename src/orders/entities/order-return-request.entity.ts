import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type ReturnStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'in_transit'
  | 'received'
  | 'credited';

export interface ReturnItem {
  orderItemId:    string;
  productId:      string;
  quantity:       number;
  returnReason:   string;
}

/**
 * Return Material Authorization (RMA) request.
 * Created automatically when quantityRejected > 0 on receipt,
 * or manually by pharmacy for post-delivery quality issues.
 */
@Entity('order_return_requests')
@Index(['orderId'])
@Index(['pharmacyTenantId', 'status'])
export class OrderReturnRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'uuid' })
  supplierTenantId: string;

  @Column({ type: 'uuid', nullable: true })
  requestedByUserId: string;

  /** Items to be returned — subset of the original order items */
  @Column({ type: 'jsonb' })
  items: ReturnItem[];

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status: ReturnStatus;

  @Column({ type: 'text', nullable: true })
  supplierNotes: string;

  /** RMA reference number issued by supplier */
  @Column({ type: 'varchar', length: 100, nullable: true })
  rmaNumber: string;

  /** Credit amount agreed by supplier */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  creditAmount: number;

  @Column({ type: 'varchar', length: 3, nullable: true })
  creditCurrency: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type NotificationType =
  | 'high_risk_stockout'
  | 'order_status_changed'
  | 'draft_created'
  | 'supplier_overdue'
  | 'delivery_confirmed'
  | 'forecast_spike'
  | 'reorder_deadline'
  | 'dead_stock_warning'
  | 'inventory_batch_complete'
  | 'inventory_batch_failed'
  | 'system';

/**
 * In-app notification per user.
 * Email is sent separately by NotificationEmailService.
 * Kept in main DB — read performance critical (bell badge on every page load).
 */
@Entity('notifications')
@Index(['tenantId', 'userId', 'isRead', 'createdAt'])
@Index(['tenantId', 'userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  /** Deep link target: e.g. "order:uuid", "recommendation:uuid", "draft:uuid" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  resourceRef: string;

  /** Whether email was also sent */
  @Column({ type: 'boolean', default: false })
  emailSent: boolean;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

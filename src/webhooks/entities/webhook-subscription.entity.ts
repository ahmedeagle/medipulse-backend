import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('webhook_subscriptions')
@Index(['tenantId', 'isActive'])
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /** Destination URL — must be HTTPS in production */
  @Column({ type: 'varchar', length: 500 })
  url: string;

  /** Array of event names this subscription listens to, e.g. ["recommendation.generated", "order.delivered"] */
  @Column({ type: 'jsonb', default: [] })
  events: string[];

  /** HMAC-SHA256 signing secret — stored here, included in X-MediPulse-Signature header */
  @Column({ type: 'varchar', length: 255 })
  secret: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Set true after 5 consecutive delivery failures — stops further delivery attempts */
  @Column({ type: 'boolean', default: false })
  requiresAttention: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

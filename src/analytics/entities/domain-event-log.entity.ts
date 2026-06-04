import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Immutable, append-only log of every domain event emitted by MediPulse.
 * Stored in the dedicated audit DB — never the main app DB.
 *
 * Purposes:
 *   - Compliance: full operational history
 *   - Event replay: reconstruct system state at any point in time
 *   - Future ML: training data for demand + recommendation models
 *   - Debugging: correlate events across services via correlationId
 */
@Entity('domain_event_logs')
@Index(['eventType', 'createdAt'])
@Index(['tenantId', 'createdAt'])
@Index(['correlationId'])
export class DomainEventLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Dot-notation event name, e.g. "order.status_changed" */
  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  /** Primary aggregate the event relates to (orderId, productId, etc.) */
  @Column({ type: 'varchar', length: 36, nullable: true })
  aggregateId: string;

  /** Aggregate type label, e.g. "order", "inventory", "recommendation" */
  @Column({ type: 'varchar', length: 50, nullable: true })
  aggregateType: string;

  /** Scoping tenant — null for system-level events */
  @Column({ type: 'uuid', nullable: true })
  tenantId: string;

  /** Full serialized event payload */
  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  /** Trace ID — links correlated events across a single request lifecycle */
  @Column({ type: 'varchar', length: 36, nullable: true })
  correlationId: string;

  @CreateDateColumn()
  createdAt: Date;
}

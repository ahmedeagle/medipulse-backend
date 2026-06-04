import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Immutable audit record — stored in the dedicated audit DB, never the main app DB.
 * No soft-delete, no updates. Append-only by design.
 */
@Entity('audit_events')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'resource', 'createdAt'])
@Index(['userId', 'createdAt'])
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The tenant that performed the action (null for unauthenticated requests) */
  @Column({ type: 'uuid', nullable: true })
  tenantId: string;

  /** The user that performed the action */
  @Column({ type: 'uuid', nullable: true })
  userId: string;

  /** Top-level resource domain: inventory | orders | ai | supplier | auth | admin */
  @Column({ type: 'varchar', length: 50 })
  resource: string;

  /** HTTP method */
  @Column({ type: 'varchar', length: 10 })
  method: string;

  /** Route template path, e.g. /api/v1/orders/:id/status */
  @Column({ type: 'varchar', length: 255 })
  path: string;

  /** HTTP response status code */
  @Column({ type: 'int' })
  statusCode: number;

  /** End-to-end request latency in milliseconds */
  @Column({ type: 'int' })
  latencyMs: number;

  /** Primary resource ID affected (from response body .id, if present) */
  @Column({ type: 'uuid', nullable: true })
  resourceId: string;

  /** Client IP address */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}

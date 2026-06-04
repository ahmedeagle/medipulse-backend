import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Logs access to sensitive read endpoints.
 * Written by AuditReadInterceptor when a route is decorated with @AuditRead().
 * Stored in the dedicated audit DB (append-only).
 *
 * Covers: supplier pricing views, AI recommendations, org cross-branch data,
 * audit log access, order details, procurement drafts.
 */
@Entity('read_access_logs')
@Index(['tenantId', 'resource', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['resource', 'createdAt'])
export class ReadAccessLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  /** Resource domain, e.g. "supplier_catalog", "ai_recommendations", "audit_logs" */
  @Column({ type: 'varchar', length: 60 })
  resource: string;

  /** Resolved route path, e.g. "/api/v1/supplier/catalog" */
  @Column({ type: 'varchar', length: 255 })
  path: string;

  /** Primary resource ID being accessed, if determinable from route params */
  @Column({ type: 'varchar', length: 36, nullable: true })
  resourceId: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}

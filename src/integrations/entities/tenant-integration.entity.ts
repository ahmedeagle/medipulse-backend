import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type IntegrationType = 'erp' | 'pos' | 'supplier_api';
export type IntegrationStatus = 'active' | 'inactive' | 'error';

/**
 * Stores integration credentials and config per tenant.
 *
 * SECURITY NOTE: `config` jsonb contains credentials (API keys, endpoints).
 * In production, encrypt at rest via RDS storage encryption + Secrets Manager
 * for the most sensitive fields. This entity stores the non-secret config
 * and references the Secrets Manager ARN for credentials.
 */
@Entity('tenant_integrations')
@Index(['tenantId', 'type'], { unique: true })
@Index(['tenantId', 'status'])
export class TenantIntegration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 20 })
  type: IntegrationType;

  /** Connector version / vendor identifier, e.g. "sap-b1", "micros-simphony" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  connectorId: string;

  /**
   * Non-sensitive config: base URL, tenant codes, field mappings.
   * Sensitive keys (API keys) should reference SECRETS_MANAGER_ARN instead.
   */
  @Column({ type: 'jsonb', default: {} })
  config: Record<string, any>;

  /** ARN of the Secrets Manager secret holding API credentials */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  secretsArn: string;

  @Column({ type: 'varchar', length: 20, default: 'inactive' })
  status: IntegrationStatus;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt: Date;

  @Column({ type: 'text', nullable: true })
  lastError: string;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

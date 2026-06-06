import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';

/**
 * Per-tenant override of an agent's enabled flag and confidence threshold.
 *
 * Absence of a row means "use the AgentDefinition defaults". Admins can
 * disable an agent for a single pharmacy without affecting others, or raise
 * the confidence bar if a tenant has been seeing too many low-quality
 * suggestions.
 */
@Entity('agent_tenant_settings')
@Unique(['tenantId', 'agentCode'])
@Index(['tenantId'])
export class AgentTenantSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 50 })
  agentCode: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Optional per-tenant override; null => inherit AgentDefinition.minConfidence. */
  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  minConfidence: number | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

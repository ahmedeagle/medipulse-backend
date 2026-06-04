import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../auth/entities/tenant.entity';
import { User } from '../../auth/entities/user.entity';

export type AuditStatus = 'success' | 'failed' | 'blocked_input' | 'blocked_output' | 'rate_limited';

/**
 * Immutable audit record for every AI generation attempt.
 * Never hard-deleted — redact fields if needed but keep the row.
 */
@Entity('ai_audit_logs')
export class AiAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @ManyToOne(() => Tenant, { eager: false })
  @JoinColumn({ name: 'pharmacyTenantId' })
  pharmacyTenant: Tenant;

  @Column({ type: 'uuid' })
  triggeredByUserId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'triggeredByUserId' })
  triggeredByUser: User;

  /** OpenAI model used, e.g. "gpt-4o-mini" */
  @Column({ type: 'varchar', length: 50 })
  model: string;

  /** Prompt version from system-prompt.ts */
  @Column({ type: 'varchar', length: 20 })
  promptVersion: string;

  @Column({ type: 'varchar', length: 20 })
  status: AuditStatus;

  /** Number of recommendations generated (0 if failed/blocked) */
  @Column({ type: 'int', default: 0 })
  recommendationsGenerated: number;

  /** Aggregate input tokens across all GPT calls in this generation run */
  @Column({ type: 'int', default: 0 })
  totalInputTokens: number;

  /** Aggregate output tokens across all GPT calls in this generation run */
  @Column({ type: 'int', default: 0 })
  totalOutputTokens: number;

  /** Wall-clock time for the entire generateRecommendations() call in ms */
  @Column({ type: 'int', default: 0 })
  latencyMs: number;

  /** Which rule types fired, e.g. ["reorder", "price_comparison"] */
  @Column({ type: 'jsonb', default: [] })
  rulesTriggered: string[];

  /** Count of GPT calls blocked by OutputGuard */
  @Column({ type: 'int', default: 0 })
  outputsBlocked: number;

  /** Error message if status = failed */
  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;
}

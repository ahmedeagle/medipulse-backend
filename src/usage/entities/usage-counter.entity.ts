import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/**
 * usage_counters — metered consumption per pharmacy per calendar month.
 *
 * One row per (tenant, period 'YYYY-MM'). Atomic upsert increments keep it cheap
 * and correct at scale. This is the source of truth for enforcing plan caps on the
 * two metered, cost-bearing resources:
 *   • aiRequests            — user-initiated AI assistant calls (LLM cost)
 *   • whatsappConversations — outbound WhatsApp sends (Meta per-conversation cost)
 */
@Entity('usage_counters')
@Index('uq_usage_tenant_period', ['pharmacyTenantId', 'period'], { unique: true })
export class UsageCounter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  /** Calendar month, 'YYYY-MM' (server/UTC). */
  @Column({ type: 'varchar', length: 7 })
  period: string;

  @Column({ type: 'int', default: 0 })
  aiRequests: number;

  @Column({ type: 'int', default: 0 })
  whatsappConversations: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

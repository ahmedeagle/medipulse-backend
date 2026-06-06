import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Registry of named AI agents (the PRD §6 contract).
 *
 * One row per agent CODE (`inventory_expert`, `purchase_expert`, …) — these
 * are the only known agents the platform exposes. Per-tenant on/off and
 * confidence-threshold overrides live in `AgentTenantSetting`.
 *
 * `permissions` / `restrictions` are intentionally free-form jsonb so the
 * governance layer can grow new scopes without a schema migration. The
 * `RulesEngine` and the worker processors check these arrays before invoking
 * any side-effect.
 */
@Entity('agent_definitions')
@Index(['category', 'phase'])
export class AgentDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable machine code — referenced by `approvals.agentCode` and config. */
  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  nameEn: string;

  @Column({ type: 'varchar', length: 120 })
  nameAr: string;

  /** Grouping for the Workforce Dashboard sidebar (inventory / procurement / catalog / marketplace). */
  @Column({ type: 'varchar', length: 40 })
  category: string;

  @Column({ type: 'text' })
  descriptionEn: string;

  @Column({ type: 'text' })
  descriptionAr: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  skills: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  permissions: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  restrictions: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  outputTypes: string[];

  /** Whether the agent is on by default for new tenants. Overridden per-tenant. */
  @Column({ type: 'boolean', default: true })
  defaultEnabled: boolean;

  /** Minimum confidence (0.00-1.00) below which outputs are suppressed entirely. */
  @Column({ type: 'decimal', precision: 4, scale: 2, default: 0.6 })
  minConfidence: number;

  /** If true (default), every output must go through the Approval Center. */
  @Column({ type: 'boolean', default: true })
  requiresApproval: boolean;

  /** PRD phase number — 1 (MVP), 2, 3. UI uses this to badge "coming soon". */
  @Column({ type: 'int', default: 1 })
  phase: number;

  /** Lucide icon name for the dashboard card. */
  @Column({ type: 'varchar', length: 40, default: 'sparkles' })
  iconKey: string;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';

export type ApprovalStatus =
  | 'pending'
  | 'modified'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'expired';

export type ApprovalPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * The single human-in-the-loop queue for ALL AI-suggested actions (PRD §11).
 *
 * Polymorphic via (subjectType, subjectId) so one queue covers heterogeneous
 * actions — purchase drafts, link suggestions, dead-stock liquidations,
 * expiry actions, … — without an N×N controller surface.
 *
 * State machine:
 *
 *     pending ──► modified ──► approved ──► executed
 *        │            │
 *        ▼            ▼
 *     rejected     rejected
 *        │
 *        └─► expired (TTL-based, set by a scheduled job)
 *
 * `originalPayload` preserves the AI's first proposal even after a human
 * edits the request to `modified`, so the audit trail can show "what the AI
 * suggested vs what the human approved" — a regulator-grade artefact.
 */
@Entity('approvals')
@Index(['tenantId', 'status', 'createdAt'])
@Index(['subjectType', 'subjectId'])
@Check(`"status" IN ('pending','modified','approved','rejected','executed','expired')`)
@Check(`"priority" IN ('low','medium','high','critical')`)
export class Approval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /** FK to AgentDefinition.code — never the UUID, so it survives reseeds. */
  @Column({ type: 'varchar', length: 50 })
  agentCode: string;

  /** Enum-like discriminator for the polymorphic target. */
  @Column({ type: 'varchar', length: 40 })
  subjectType: string;

  @Column({ type: 'uuid' })
  subjectId: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  summary: string;

  /** Human-readable "why this recommendation" — PRD §13 explanation engine. */
  @Column({ type: 'text' })
  rationale: string;

  @Column({ type: 'decimal', precision: 4, scale: 2, default: 0 })
  confidence: number;

  @Column({ type: 'varchar', length: 20, default: 'low' })
  confidenceLabel: 'very_high' | 'high' | 'medium' | 'low';

  /**
   * Human-readable explanation of *why* the confidence is what it is — PRD §14.
   * Different from `rationale` (which says *what* to do): this answers "why
   * should I trust this number?" e.g. "60-day stable sales pattern" or
   * "supplier reliability 92%".
   */
  @Column({ type: 'text', nullable: true })
  confidenceReason: string | null;

  @Column({ type: 'varchar', length: 10, default: 'medium' })
  priority: ApprovalPriority;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ApprovalStatus;

  /** Currently-effective payload — overwritten when a user `modify`s. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload: Record<string, any>;

  /** What the agent originally proposed before any human edit. */
  @Column({ type: 'jsonb', nullable: true })
  originalPayload: Record<string, any> | null;

  /** Which agent created this approval — denormalised for fast filtering. */
  @Column({ type: 'varchar', length: 50 })
  createdByAgent: string;

  @CreateDateColumn() createdAt: Date;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionNote: string | null;

  @Column({ type: 'timestamp', nullable: true })
  executedAt: Date | null;

  /** Free-form receipt of the downstream side-effect (e.g. `{ purchaseOrderId }`). */
  @Column({ type: 'jsonb', nullable: true })
  executionResult: Record<string, any> | null;

  /** Optional TTL — after this point a sweeper job flips to `expired`. */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @UpdateDateColumn() updatedAt: Date;
}

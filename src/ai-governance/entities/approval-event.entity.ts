import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Check,
} from 'typeorm';

export type ApprovalActorType = 'user' | 'agent' | 'system' | 'scheduler';

/**
 * Append-only journal of approval state transitions (PRD §12).
 *
 * Read patterns:
 *   - Full life of one approval:  WHERE approvalId = ? ORDER BY createdAt
 *   - Tenant compliance audit:    WHERE tenantId = ? AND createdAt BETWEEN ...
 *
 * `payloadDiff` stores the JSON diff between previous and new payload on
 * `modified` events — enables "what changed?" UI without re-querying the
 * approval row history.
 */
@Entity('approval_events')
@Index(['approvalId', 'createdAt'])
@Index(['tenantId', 'createdAt'])
@Check(`"actorType" IN ('user','agent','system','scheduler')`)
export class ApprovalEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  approvalId: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 50 })
  agentCode: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  fromStatus: string | null;

  @Column({ type: 'varchar', length: 20 })
  toStatus: string;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'user' })
  actorType: ApprovalActorType;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payloadDiff: Record<string, { from: any; to: any }> | null;

  @CreateDateColumn()
  createdAt: Date;
}

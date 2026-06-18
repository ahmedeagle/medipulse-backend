import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FeatureRequestStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type FeatureRequestPriority = 'low' | 'medium' | 'high' | 'critical';

@Entity('feature_requests')
@Index(['tenantId', 'status'])
@Index(['assignedToUserId'])
export class FeatureRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human-readable tracking ID shown to the pharmacy (FEAT-XXXXXX). */
  @Column({ length: 20, unique: true })
  trackingNumber: string;

  @Column('uuid')
  tenantId: string;

  @Column('uuid', { nullable: true })
  submittedByUserId: string | null;

  /** The exact chat question that triggered the not-configured response. */
  @Column('text')
  question: string;

  /** Context hint derived from NOT_CONFIGURED_REASONS keyword map. */
  @Column('text', { nullable: true })
  hint: string | null;

  @Column({ default: 'medium' })
  priority: FeatureRequestPriority;

  @Column({ default: 'open' })
  status: FeatureRequestStatus;

  /** GX1 team member assigned to handle this request (set by SYSTEM_ADMIN). */
  @Column('uuid', { nullable: true })
  assignedToUserId: string | null;

  @Column('text', { nullable: true })
  resolution: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column('timestamp with time zone', { nullable: true })
  resolvedAt: Date | null;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TenantType } from '../../common/enums/tenant-type.enum';

export type BranchRole = 'branch' | 'central' | 'standalone';

@Entity('tenants')
@Index(['organizationId'])
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug: string;

  @Column({ type: 'enum', enum: TenantType })
  type: TenantType;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Subscription plan whose usage caps apply (free | starter | pro | enterprise). */
  @Column({ type: 'varchar', length: 16, default: 'free' })
  planTier: string;

  // ── Multi-org hierarchy fields (Phase 1.5 Month 3) ───────────────────────

  /** Parent organization (pharmacy chain / hospital network). Null = standalone. */
  @Column({ type: 'uuid', nullable: true })
  organizationId: string;

  /**
   * Role within the organization.
   * - standalone: independent tenant (default)
   * - branch: member of an organization, uses central procurement
   * - central: headquarters with cross-branch visibility
   */
  @Column({ type: 'varchar', length: 20, default: 'standalone' })
  branchRole: BranchRole;

  /** City — used for regional demand intelligence */
  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string;

  /** Region — used for regional demand signals */
  @Column({ type: 'varchar', length: 100, nullable: true })
  region: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany('User', 'tenant')
  users: any[];
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';

export type OrganizationType = 'chain' | 'hospital_network' | 'group';

/**
 * Parent organization entity — represents a pharmacy chain, hospital network, or group.
 * One Organization → many Tenants (branches).
 * CHAIN_ADMIN users see aggregated data across all tenants in their organization.
 */
@Entity('organizations')
@Index(['slug'], { unique: true })
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 30 })
  type: OrganizationType;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type DisputeType = 'wrong_qty' | 'wrong_product' | 'damaged' | 'expired';
export type DisputeStatus = 'open' | 'resolved' | 'rejected';

@Entity('p2p_disputes')
@Index(['p2pOrderId'])
@Index(['status'])
export class P2pDispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  p2pOrderId: string;

  @Column({ type: 'uuid' })
  raisedByTenantId: string;

  @Column({ type: 'varchar', length: 30 })
  type: DisputeType;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', default: [] })
  evidenceUrls: string[];

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: DisputeStatus;

  @Column({ type: 'text', nullable: true })
  adminNotes: string;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('p2p_reviews')
@Index(['sellerTenantId', 'createdAt'])
@Index(['sellerTenantId', 'rating'])
@Index(['buyerTenantId', 'createdAt'])
export class P2pReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  orderId: string;

  @Column({ type: 'uuid' })
  buyerTenantId: string;

  @Column({ type: 'uuid' })
  sellerTenantId: string;

  /** 1–5 (CHECK constraint enforced at DB level) */
  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

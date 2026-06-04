import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type RecallType    = 'urgent' | 'voluntary' | 'market_withdrawal';
export type RecallStatus  = 'active' | 'resolved';

/**
 * SFDA product recall entity.
 *
 * Created by system admin when SFDA issues a recall notice.
 * On creation, triggers ProductRecallEvent which:
 *   - Marks all matching ProductBatch records as recalled
 *   - Flags all InventoryItems containing that batch as quarantined
 *   - Notifies all affected pharmacies (in-app + email)
 *   - Creates OrderReturnRequests for open orders containing the recalled product
 *
 * batchNumber = null means the recall applies to all batches of the product.
 */
@Entity('product_recalls')
@Index(['productId', 'status'])
@Index(['status', 'effectiveAt'])
export class ProductRecall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  /**
   * Null = recall applies to ALL batches of this product.
   * Set = recall limited to this specific batch number.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  batchNumber: string;

  @Column({ type: 'varchar', length: 30 })
  recallType: RecallType;

  /** Official SFDA/MOH recall reference number */
  @Column({ type: 'varchar', length: 100 })
  recallReferenceNumber: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'timestamp' })
  issuedAt: Date;

  @Column({ type: 'timestamp' })
  effectiveAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolutionDeadline: Date;

  /** Auto-computed: UUID list of pharmacies holding affected product/batch */
  @Column({ type: 'jsonb', default: [] })
  affectedPharmacyIds: string[];

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: RecallStatus;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}

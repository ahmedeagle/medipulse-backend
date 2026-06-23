import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn,
} from 'typeorm';

@Entity('purchase_return_lines')
@Index(['returnId'])
@Index(['productId'])
export class PurchaseReturnLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  returnId: string;

  @ManyToOne('PurchaseReturn', 'lines', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'returnId' })
  purchaseReturn: any;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'varchar', length: 255 })
  productName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  productSku: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  batchNumber: string;

  @Column({ type: 'date', nullable: true })
  expiryDate: Date;

  @Column({ type: 'int', default: 0 })
  availableQty: number;

  @Column({ type: 'int', default: 0 })
  returnQty: number;

  @Column({ type: 'int', default: 0 })
  freeGoodsQty: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  returnPrice: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  discountPct: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxPct: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  lineTotal: number;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

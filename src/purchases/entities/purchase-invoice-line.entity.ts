import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn,
} from 'typeorm';

@Entity('purchase_invoice_lines')
@Index(['invoiceId'])
@Index(['productId', 'supplierTenantId'])
export class PurchaseInvoiceLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @ManyToOne('PurchaseInvoice', 'lines', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: any;

  @Column({ type: 'uuid', nullable: true })
  supplierTenantId: string;

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
  purchaseQty: number;

  @Column({ type: 'int', default: 0 })
  freeGoodsQty: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  purchasePrice: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  salePrice: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  discountPct: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxPct: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  lineTotal: number;

  @Column({ type: 'boolean', default: false })
  priceWarningShown: boolean;

  @Column({ type: 'boolean', default: false })
  priceWarningDismissed: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

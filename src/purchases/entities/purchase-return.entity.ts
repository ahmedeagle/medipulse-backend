import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index, OneToMany,
} from 'typeorm';

export type ReturnStatus = 'draft' | 'confirmed' | 'cancelled';

@Entity('purchase_returns')
@Index(['pharmacyTenantId', 'deletedAt'])
@Index(['pharmacyTenantId', 'status'])
@Index(['pharmacyTenantId', 'createdAt'])
@Index(['pharmacyTenantId', 'supplierTenantId'])
export class PurchaseReturn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'varchar', length: 20 })
  rpoNumber: string;

  @Column({ type: 'int', default: 1 })
  rpoSequence: number;

  @Column({ type: 'uuid', nullable: true })
  supplierTenantId: string;

  @Column({ type: 'varchar', length: 255 })
  supplierName: string;

  @Column({ type: 'date', nullable: true })
  supplierInvoiceDate: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  supplierInvoiceNumber: string;

  @Column({ type: 'varchar', length: 30, default: 'cash' })
  paymentMethod: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  paymentStatus: string;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: ReturnStatus;

  @Column({ type: 'varchar', length: 10, default: 'percent' })
  discountType: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discountValue: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalDiscount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalTax: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  grandTotal: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'uuid' })
  createdBy: string;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date;

  @OneToMany('PurchaseReturnLine', 'purchaseReturn', { eager: true, cascade: ['insert', 'update'] })
  lines: any[];

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

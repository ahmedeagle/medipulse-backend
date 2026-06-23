import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index, OneToMany,
} from 'typeorm';

export type InvoiceStatus  = 'draft' | 'received' | 'paid' | 'cancelled';
export type PaymentMethod  = 'cash' | 'credit_card' | 'bank_transfer' | 'credit_term';
export type PaymentStatus  = 'pending' | 'paid';
export type DiscountType   = 'percent' | 'fixed';

@Entity('purchase_invoices')
@Index(['pharmacyTenantId', 'deletedAt'])
@Index(['pharmacyTenantId', 'status'])
@Index(['pharmacyTenantId', 'createdAt'])
@Index(['pharmacyTenantId', 'supplierTenantId'])
@Index(['pharmacyTenantId', 'paymentStatus'])
export class PurchaseInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'varchar', length: 20 })
  poNumber: string;

  @Column({ type: 'int', default: 1 })
  poSequence: number;

  @Column({ type: 'uuid', nullable: true })
  supplierTenantId: string;

  @Column({ type: 'varchar', length: 255 })
  supplierName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  supplierInvoiceNumber: string;

  @Column({ type: 'date', nullable: true })
  invoiceDate: Date;

  @Column({ type: 'varchar', length: 30, default: 'cash' })
  paymentMethod: PaymentMethod;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  paymentStatus: PaymentStatus;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: InvoiceStatus;

  @Column({ type: 'varchar', length: 10, default: 'percent' })
  discountType: DiscountType;

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
  cancelledAt: Date;

  @Column({ type: 'uuid', nullable: true })
  cancelledBy: string;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date;

  @OneToMany('PurchaseInvoiceLine', 'invoice', { eager: true, cascade: ['insert', 'update'] })
  lines: any[];

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

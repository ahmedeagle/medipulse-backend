import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum PaymentMethod {
  BANK_TRANSFER  = 'bank_transfer',
  CHEQUE         = 'cheque',
  CREDIT_WALLET  = 'credit_wallet',
  BNPL           = 'bnpl',
  CASH           = 'cash',
}

export enum PaymentStatus {
  INITIATED = 'initiated',
  PENDING   = 'pending',
  SETTLED   = 'settled',
  FAILED    = 'failed',
  REVERSED  = 'reversed',
}

@Entity('payment_transactions')
@Index('ix_payment_order', ['orderId'])
@Index('ix_payment_pharmacy', ['pharmacyTenantId', 'createdAt'])
@Index('ix_payment_supplier', ['supplierTenantId', 'createdAt'])
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'pharmacy_tenant_id' })
  pharmacyTenantId: string;

  @Column({ name: 'supplier_tenant_id' })
  supplierTenantId: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ length: 3, default: 'SAR' })
  currency: string;

  @Column({ name: 'payment_method', type: 'varchar', length: 30 })
  paymentMethod: PaymentMethod;

  @Column({ name: 'status', type: 'varchar', length: 20, default: PaymentStatus.INITIATED })
  status: PaymentStatus;

  @Column({ name: 'reference_number', length: 100, nullable: true })
  referenceNumber: string | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  /** Links to ledger entry that records this payment */
  @Column({ name: 'ledger_entry_id', nullable: true })
  ledgerEntryId: string | null;

  @Column({ name: 'initiated_by', length: 64 })
  initiatedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

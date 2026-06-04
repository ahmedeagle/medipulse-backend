import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum SettlementStatus {
  PENDING     = 'pending',
  IN_PROGRESS = 'in_progress',
  SETTLED     = 'settled',
  DISPUTED    = 'disputed',
}

/**
 * Periodic batch settlement sent to suppliers.
 * Aggregates all delivered orders in a period minus returns and credits.
 */
@Entity('supplier_settlements')
@Index('ix_settlement_supplier', ['supplierTenantId', 'periodStart'])
export class SupplierSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'supplier_tenant_id' })
  supplierTenantId: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: Date;

  @Column({ name: 'total_gross', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalGross: number;

  @Column({ name: 'total_returns', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalReturns: number;

  @Column({ name: 'total_credits', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalCredits: number;

  @Column({ name: 'net_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  netAmount: number;

  @Column({ length: 3, default: 'SAR' })
  currency: string;

  @Column({ name: 'order_count', default: 0 })
  orderCount: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: SettlementStatus.PENDING })
  status: SettlementStatus;

  @Column({ name: 'settlement_reference', length: 100, nullable: true })
  settlementReference: string | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @Column({ name: 'approved_by', length: 64, nullable: true })
  approvedBy: string | null;

  @Column({ name: 'dispute_reason', type: 'text', nullable: true })
  disputeReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum WalletStatus {
  ACTIVE    = 'active',
  SUSPENDED = 'suspended',
  REVIEW    = 'review',
  CLOSED    = 'closed',
}

/**
 * CreditWallet — per-pharmacy revolving credit facility.
 * Foundation for BNPL and Net-30/60/90 payment terms.
 *
 * availableCredit = creditLimit - utilizedCredit
 * Every approved order decrements utilizedCredit.
 * Every confirmed payment restores it.
 */
@Entity('credit_wallets')
@Index('ix_credit_wallet_tenant', ['tenantId'], { unique: true })
export class CreditWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', unique: true })
  tenantId: string;

  @Column({ name: 'credit_limit', type: 'decimal', precision: 15, scale: 2, default: 0 })
  creditLimit: number;

  @Column({ name: 'utilized_credit', type: 'decimal', precision: 15, scale: 2, default: 0 })
  utilizedCredit: number;

  @Column({ length: 3, default: 'SAR' })
  currency: string;

  @Column({ name: 'status', type: 'varchar', length: 20, default: WalletStatus.ACTIVE })
  status: WalletStatus;

  @Column({ name: 'expires_at', type: 'date', nullable: true })
  expiresAt: Date | null;

  /** Alert when utilization crosses this threshold (0.0 – 1.0) */
  @Column({ name: 'utilization_alert_threshold', type: 'decimal', precision: 4, scale: 2, default: 0.80 })
  utilizationAlertThreshold: number;

  @Column({ name: 'suspension_reason', type: 'text', nullable: true })
  suspensionReason: string | null;

  @Column({ name: 'approved_by', length: 64, nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  get availableCredit(): number {
    return Math.max(0, Number(this.creditLimit) - Number(this.utilizedCredit));
  }

  get utilizationRate(): number {
    return this.creditLimit > 0 ? Number(this.utilizedCredit) / Number(this.creditLimit) : 0;
  }
}

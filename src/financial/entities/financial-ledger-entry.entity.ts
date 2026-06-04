import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Check,
} from 'typeorm';

export enum AccountType {
  AP       = 'ap',       // Accounts Payable  — pharmacy owes supplier
  AR       = 'ar',       // Accounts Receivable — supplier is owed
  REVENUE  = 'revenue',  // Supplier earned
  CREDIT   = 'credit',   // Credit note issued
  EXPENSE  = 'expense',  // Operational cost
  ESCROW   = 'escrow',   // Held funds (disputes)
  CASH     = 'cash',     // Actual payment received/sent
}

export enum LedgerReferenceType {
  ORDER      = 'order',
  INVOICE    = 'invoice',
  PAYMENT    = 'payment',
  RETURN     = 'return',
  CREDIT_NOTE = 'credit_note',
  ADJUSTMENT = 'adjustment',
  SETTLEMENT = 'settlement',
}

/**
 * Immutable double-entry financial ledger.
 * Every financial event creates exactly TWO entries (debit + credit).
 * Entries are NEVER updated or deleted — reversals create new entries.
 *
 * Invariant: debitAmount XOR creditAmount is non-null per entry.
 */
@Entity('financial_ledger_entries')
@Index('ix_ledger_tenant_date', ['tenantId', 'entryDate'])
@Index('ix_ledger_reference', ['referenceType', 'referenceId'])
@Index('ix_ledger_account_tenant', ['accountType', 'tenantId'])
export class FinancialLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'account_type', type: 'varchar', length: 20 })
  accountType: AccountType;

  @Column({ name: 'debit_amount', type: 'decimal', precision: 15, scale: 2, nullable: true })
  debitAmount: number | null;

  @Column({ name: 'credit_amount', type: 'decimal', precision: 15, scale: 2, nullable: true })
  creditAmount: number | null;

  @Column({ length: 3, default: 'SAR' })
  currency: string;

  @Column({ name: 'reference_type', type: 'varchar', length: 30 })
  referenceType: LedgerReferenceType;

  @Column({ name: 'reference_id' })
  referenceId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'entry_date', type: 'date' })
  entryDate: Date;

  /** Points to the entry this one reverses (null if original) */
  @Column({ name: 'reversal_of_id', nullable: true })
  reversalOfId: string | null;

  /** Points to the reversal entry (null until reversed) */
  @Column({ name: 'reversed_by_id', nullable: true })
  reversedById: string | null;

  @Column({ name: 'correlation_id', length: 64, nullable: true })
  correlationId: string | null;

  @CreateDateColumn({ name: 'posted_at' })
  postedAt: Date;
}

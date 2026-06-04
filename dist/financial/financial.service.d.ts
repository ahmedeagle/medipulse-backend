import { Repository, EntityManager, DataSource } from 'typeorm';
import { FinancialLedgerEntry, AccountType, LedgerReferenceType } from './entities/financial-ledger-entry.entity';
import { CreditWallet } from './entities/credit-wallet.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { SupplierSettlement } from './entities/supplier-settlement.entity';
export interface JournalEntry {
    debitAccount: AccountType;
    creditAccount: AccountType;
    amount: number;
    currency: string;
    referenceType: LedgerReferenceType;
    referenceId: string;
    description: string;
    tenantId: string;
    correlationId?: string;
}
export declare class FinancialService {
    private readonly ledgerRepo;
    private readonly walletRepo;
    private readonly paymentRepo;
    private readonly settlementRepo;
    private readonly dataSource;
    constructor(ledgerRepo: Repository<FinancialLedgerEntry>, walletRepo: Repository<CreditWallet>, paymentRepo: Repository<PaymentTransaction>, settlementRepo: Repository<SupplierSettlement>, dataSource: DataSource);
    postJournal(entry: JournalEntry, em?: EntityManager): Promise<void>;
    reverseEntry(originalEntryId: string, reason: string, em?: EntityManager): Promise<void>;
    getWallet(tenantId: string): Promise<CreditWallet | null>;
    getOrCreateWallet(tenantId: string): Promise<CreditWallet>;
    debitWallet(tenantId: string, amount: number, orderId: string): Promise<void>;
    creditWallet(tenantId: string, amount: number): Promise<void>;
    setWalletLimit(tenantId: string, limitSar: number, approvedBy: string): Promise<CreditWallet>;
    getLedger(tenantId: string, from: Date, to: Date, page?: number, limit?: number): Promise<{
        items: FinancialLedgerEntry[];
        total: number;
        page: number;
        limit: number;
    }>;
    getBalance(tenantId: string): Promise<Record<string, number>>;
    getReconciliation(orderId: string): Promise<FinancialLedgerEntry[]>;
    getSettlements(supplierTenantId: string): Promise<SupplierSettlement[]>;
    approveSettlement(id: string, approvedBy: string): Promise<SupplierSettlement>;
}

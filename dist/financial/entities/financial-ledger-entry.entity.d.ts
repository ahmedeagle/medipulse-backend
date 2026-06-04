export declare enum AccountType {
    AP = "ap",
    AR = "ar",
    REVENUE = "revenue",
    CREDIT = "credit",
    EXPENSE = "expense",
    ESCROW = "escrow",
    CASH = "cash"
}
export declare enum LedgerReferenceType {
    ORDER = "order",
    INVOICE = "invoice",
    PAYMENT = "payment",
    RETURN = "return",
    CREDIT_NOTE = "credit_note",
    ADJUSTMENT = "adjustment",
    SETTLEMENT = "settlement"
}
export declare class FinancialLedgerEntry {
    id: string;
    tenantId: string;
    accountType: AccountType;
    debitAmount: number | null;
    creditAmount: number | null;
    currency: string;
    referenceType: LedgerReferenceType;
    referenceId: string;
    description: string;
    entryDate: Date;
    reversalOfId: string | null;
    reversedById: string | null;
    correlationId: string | null;
    postedAt: Date;
}

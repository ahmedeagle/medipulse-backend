export declare enum PaymentMethod {
    BANK_TRANSFER = "bank_transfer",
    CHEQUE = "cheque",
    CREDIT_WALLET = "credit_wallet",
    BNPL = "bnpl",
    CASH = "cash"
}
export declare enum PaymentStatus {
    INITIATED = "initiated",
    PENDING = "pending",
    SETTLED = "settled",
    FAILED = "failed",
    REVERSED = "reversed"
}
export declare class PaymentTransaction {
    id: string;
    orderId: string;
    pharmacyTenantId: string;
    supplierTenantId: string;
    amount: number;
    currency: string;
    paymentMethod: PaymentMethod;
    status: PaymentStatus;
    referenceNumber: string | null;
    settledAt: Date | null;
    failureReason: string | null;
    ledgerEntryId: string | null;
    initiatedBy: string;
    createdAt: Date;
    updatedAt: Date;
}

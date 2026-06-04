export declare enum SettlementStatus {
    PENDING = "pending",
    IN_PROGRESS = "in_progress",
    SETTLED = "settled",
    DISPUTED = "disputed"
}
export declare class SupplierSettlement {
    id: string;
    supplierTenantId: string;
    periodStart: Date;
    periodEnd: Date;
    totalGross: number;
    totalReturns: number;
    totalCredits: number;
    netAmount: number;
    currency: string;
    orderCount: number;
    status: SettlementStatus;
    settlementReference: string | null;
    settledAt: Date | null;
    approvedBy: string | null;
    disputeReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}

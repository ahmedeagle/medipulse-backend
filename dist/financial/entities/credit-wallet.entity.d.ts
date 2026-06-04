export declare enum WalletStatus {
    ACTIVE = "active",
    SUSPENDED = "suspended",
    REVIEW = "review",
    CLOSED = "closed"
}
export declare class CreditWallet {
    id: string;
    tenantId: string;
    creditLimit: number;
    utilizedCredit: number;
    currency: string;
    status: WalletStatus;
    expiresAt: Date | null;
    utilizationAlertThreshold: number;
    suspensionReason: string | null;
    approvedBy: string | null;
    approvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    get availableCredit(): number;
    get utilizationRate(): number;
}

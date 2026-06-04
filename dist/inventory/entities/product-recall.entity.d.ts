export type RecallType = 'urgent' | 'voluntary' | 'market_withdrawal';
export type RecallStatus = 'active' | 'resolved';
export declare class ProductRecall {
    id: string;
    productId: string;
    batchNumber: string;
    recallType: RecallType;
    recallReferenceNumber: string;
    description: string;
    issuedAt: Date;
    effectiveAt: Date;
    resolutionDeadline: Date;
    affectedPharmacyIds: string[];
    status: RecallStatus;
    resolvedAt: Date;
    createdByUserId: string;
    createdAt: Date;
}

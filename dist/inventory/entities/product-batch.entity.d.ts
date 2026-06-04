export type BatchStatus = 'active' | 'quarantined' | 'recalled' | 'expired' | 'returned';
export declare class ProductBatch {
    id: string;
    productId: string;
    supplierTenantId: string;
    batchNumber: string;
    manufacturingDate: Date;
    expiryDate: Date;
    costPerUnit: number;
    currency: string;
    status: BatchStatus;
    quarantineReason: string;
    quarantinedAt: Date;
    quarantinedByUserId: string;
    recallReferenceNumber: string;
    recallIssuedAt: Date;
    recallId: string;
    createdAt: Date;
}

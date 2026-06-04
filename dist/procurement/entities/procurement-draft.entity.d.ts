export type DraftStatus = 'pending_review' | 'approved' | 'rejected' | 'converted_to_order' | 'expired';
export type UrgencyLevel = 'critical' | 'high' | 'medium';
export declare class ProcurementDraft {
    id: string;
    pharmacyTenantId: string;
    supplierTenantId: string;
    productId: string;
    suggestedQuantity: number;
    unitPrice: number;
    currency: string;
    urgencyLevel: UrgencyLevel;
    recommendationId: string;
    status: DraftStatus;
    convertedOrderId: string;
    rejectionReason: string;
    expiresAt: Date;
    createdAt: Date;
}

export type ReturnStatus = 'pending' | 'approved' | 'rejected' | 'in_transit' | 'received' | 'credited';
export interface ReturnItem {
    orderItemId: string;
    productId: string;
    quantity: number;
    returnReason: string;
}
export declare class OrderReturnRequest {
    id: string;
    orderId: string;
    pharmacyTenantId: string;
    supplierTenantId: string;
    requestedByUserId: string;
    items: ReturnItem[];
    status: ReturnStatus;
    supplierNotes: string;
    rmaNumber: string;
    creditAmount: number;
    creditCurrency: string;
    rejectionReason: string;
    resolvedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

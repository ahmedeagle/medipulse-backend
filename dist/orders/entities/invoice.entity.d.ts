export type InvoiceStatus = 'draft' | 'issued' | 'cancelled' | 'disputed';
export declare class Invoice {
    id: string;
    orderId: string;
    pharmacyTenantId: string;
    supplierTenantId: string;
    invoiceNumber: string;
    issueDate: Date;
    dueDate: Date;
    subtotalAmount: number;
    vatRate: number;
    vatAmount: number;
    totalAmount: number;
    currency: string;
    buyerName: string;
    buyerCrn: string;
    buyerVatNumber: string;
    buyerAddress: string;
    sellerName: string;
    sellerCrn: string;
    sellerVatNumber: string;
    sellerAddress: string;
    qrCode: string;
    status: InvoiceStatus;
    issuedAt: Date;
    cancelledAt: Date;
    cancellationReason: string;
    createdAt: Date;
}

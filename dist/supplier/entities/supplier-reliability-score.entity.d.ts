export declare class SupplierReliabilityScore {
    id: string;
    supplierTenantId: string;
    productId: string;
    acceptanceRate: number;
    avgDeliveryDays: number;
    fulfillmentRate: number;
    sampleSize: number;
    overallScore: number;
    reliabilityLabel: string;
    lastCalculatedAt: Date;
}

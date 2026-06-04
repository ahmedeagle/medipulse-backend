export declare class ProcurementSchedule {
    id: string;
    tenantId: string;
    productId: string;
    eoqQty: number;
    safetyStockQty: number;
    reorderPoint: number;
    effectiveLeadTimeDays: number;
    serviceLevel: number;
    reorderByDate: Date;
    predictedStockoutDate: Date;
    daysUntilReorderNeeded: number;
    recommendedSupplierTenantId: string;
    updatedAt: Date;
    createdAt: Date;
}

export declare class WeeklyAnalyticsSnapshot {
    id: string;
    tenantId: string;
    weekStart: Date;
    totalOrders: number;
    totalSpend: number;
    currency: string;
    recommendationsGenerated: number;
    recommendationsActedOn: number;
    recommendationConversionRate: number;
    stockoutEvents: number;
    topProductId: string;
    computedAt: Date;
}

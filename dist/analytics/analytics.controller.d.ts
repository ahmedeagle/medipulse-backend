import { AnalyticsReadService } from './analytics-read.service';
export declare class AnalyticsController {
    private readonly svc;
    constructor(svc: AnalyticsReadService);
    getDashboard(user: any, weeks: number): Promise<import("./entities/weekly-analytics-snapshot.entity").WeeklyAnalyticsSnapshot[]>;
    getRegionalPricing(productId: string): Promise<import("./analytics-read.service").RegionalPrice[]>;
    getPriceTrend(productId: string, supplierTenantId: string, days: number): Promise<import("./analytics-read.service").PricePoint[]>;
}

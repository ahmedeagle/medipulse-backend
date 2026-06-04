export declare class DemandForecast {
    id: string;
    tenantId: string;
    productId: string;
    forecastDate: Date;
    horizonDays: number;
    forecastedQty: number;
    confidenceIntervalLow: number;
    confidenceIntervalHigh: number;
    estimatedDailyDemand: number;
    trend: 'increasing' | 'stable' | 'decreasing';
    trendMagnitude: number;
    algorithm: string;
    trainingDataPoints: number;
    actualQty: number;
    mapeError: number;
    createdAt: Date;
}

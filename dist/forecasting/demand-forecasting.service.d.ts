import { Repository } from 'typeorm';
import { DemandForecast } from './entities/demand-forecast.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';
export interface ForecastResult {
    forecastedQty: number;
    confidenceIntervalLow: number;
    confidenceIntervalHigh: number;
    estimatedDailyDemand: number;
    trend: 'increasing' | 'stable' | 'decreasing';
    trendMagnitude: number;
    trainingDataPoints: number;
}
export declare class DemandForecastingService {
    private readonly forecastRepo;
    private readonly snapshotRepo;
    private readonly tenantRepo;
    private readonly logger;
    constructor(forecastRepo: Repository<DemandForecast>, snapshotRepo: Repository<ConsumptionSnapshot>, tenantRepo: Repository<Tenant>);
    computeAllForecasts(): Promise<void>;
    computeForecasts(tenantId: string): Promise<number>;
    holtsLinearForecast(snapshots: ConsumptionSnapshot[], horizonDays: number): ForecastResult;
    getForecasts(tenantId: string, productId: string): Promise<DemandForecast[]>;
    getForecastMap(tenantId: string, productIds: string[], horizonDays?: number): Promise<Map<string, DemandForecast>>;
    updateAccuracy(): Promise<void>;
    private upsertForecast;
    private getLastMonday;
}

import { DemandForecastingService } from './demand-forecasting.service';
import { EoqService } from './eoq.service';
import { DeadStockService } from '../inventory/dead-stock.service';
export declare class ForecastingController {
    private readonly forecastingSvc;
    private readonly eoqSvc;
    private readonly deadStockSvc;
    constructor(forecastingSvc: DemandForecastingService, eoqSvc: EoqService, deadStockSvc: DeadStockService);
    getDemandForecast(user: any, productId: string): Promise<import("./entities/demand-forecast.entity").DemandForecast[]>;
    getEoqSchedule(user: any, productId: string): Promise<import("./entities/procurement-schedule.entity").ProcurementSchedule>;
    getDeadStock(user: any): Promise<import("../inventory/dead-stock.service").DeadStockAnalysis[]>;
    getDeadStockSummary(user: any): Promise<{
        value: number;
        count: number;
    }>;
    refreshForecasts(user: any): Promise<{
        message: string;
        forecastsComputed: number;
    }>;
}

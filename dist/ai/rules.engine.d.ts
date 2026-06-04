import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { DemandForecast } from '../forecasting/entities/demand-forecast.entity';
import { ProcurementSchedule } from '../forecasting/entities/procurement-schedule.entity';
import { RecommendationType } from '../common/enums/recommendation-type.enum';
import { DemandSignal as HijriDemandSignal } from '../common/utils/hijri-calendar';
export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type DemandTrend = 'increasing' | 'stable' | 'decreasing';
export interface RawRecommendation {
    type: RecommendationType;
    productId: string | null;
    riskLevel: RiskLevel;
    payload: Record<string, any>;
}
export interface RulesEngineContext {
    supplierScores?: Map<string, SupplierReliabilityScore>;
    consumptionData?: Map<string, ConsumptionSnapshot[]>;
    forecastData?: Map<string, DemandForecast>;
    scheduleData?: Map<string, ProcurementSchedule>;
    region?: string;
}
export declare class SeasonalityEngine {
    private readonly today;
    constructor(date?: Date);
    getSignal(category: string): HijriDemandSignal;
    getMultiplierDelta(category: string): number;
    getEventLabel(): string;
}
export interface DemandSignal {
    avg30: number;
    avg90: number;
    trend: DemandTrend;
    dailyUsage: number;
}
export declare class DemandEngine {
    getSignal(productId: string, orderHistory: {
        productId: string;
        quantity: number;
        createdAt: Date;
    }[]): DemandSignal;
}
export declare class RiskEngine {
    assess(stockDays: number, expectedNeedDays: number): RiskLevel;
    stockDays(currentQuantity: number, dailyUsage: number): number;
    suggestedReorderQty(dailyUsage: number, currentQuantity: number, leadDays?: number): number;
}
export declare class RulesEngine {
    private readonly demand;
    private readonly risk;
    generateRecommendations(inventoryItems: InventoryItem[], supplierCatalog: SupplierCatalogItem[], orderHistory?: {
        productId: string;
        quantity: number;
        createdAt: Date;
    }[], ctx?: RulesEngineContext): RawRecommendation[];
    private pickBestSupplier;
}

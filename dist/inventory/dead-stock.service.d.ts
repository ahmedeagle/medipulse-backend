import { Repository, DataSource } from 'typeorm';
import { PriceSnapshot } from '../analytics/entities/price-snapshot.entity';
export type LiquidationAction = 'return_to_supplier' | 'markdown' | 'write_off' | 'monitor';
export interface DeadStockAnalysis {
    productId: string;
    productName: string;
    currentQuantity: number;
    weeksWithoutMovement: number;
    estimatedValue: number;
    expiryRisk: 'critical' | 'high' | 'none';
    daysToExpiry: number | null;
    recommendedAction: LiquidationAction;
    actionReason: string;
    urgencyScore: number;
    deadStockProbability: number;
    classifierConfidence: 'high' | 'medium' | 'low';
}
export declare class DeadStockService {
    private readonly priceRepo;
    private readonly dataSource;
    constructor(priceRepo: Repository<PriceSnapshot>, dataSource: DataSource);
    analyzeDeadStock(tenantId: string): Promise<DeadStockAnalysis[]>;
    getTotalDeadStockValue(tenantId: string): Promise<{
        value: number;
        count: number;
    }>;
    private estimateValue;
    private computeDeadStockProbability;
    private recommendAction;
}

export type ConfidenceLabel = 'high' | 'medium' | 'low';
export interface ConfidenceScore {
    score: number;
    label: ConfidenceLabel;
    factors: Record<string, number>;
}
export declare class ConfidenceEngine {
    compute(params: {
        historyDays: number;
        trend: 'increasing' | 'stable' | 'decreasing';
        seasonalMultiplier: number;
        suppliersAvailable: number;
        currentQuantity: number;
        minThreshold: number;
    }): ConfidenceScore;
    private toLabel;
}

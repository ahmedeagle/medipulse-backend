export declare class RecommendationDecisionTrace {
    id: string;
    recommendationId: string;
    tenantId: string;
    rulesEvaluated: Array<{
        rule: string;
        triggered: boolean;
        contribution: string;
        weight?: number;
    }>;
    supplierScoresConsidered: Array<{
        supplierTenantId: string;
        score: number;
        rank: number;
        wasSelected: boolean;
    }>;
    forecastUsed: {
        algorithm: string;
        forecastedQty: number;
        confidence: number;
        horizonDays: number;
        trainingPoints: number;
    } | null;
    seasonalSignal: {
        event: string | null;
        source: string;
        multiplier: number;
        category: string;
    } | null;
    eoqUsed: {
        eoqQty: number;
        safetyStockQty: number;
        reorderPoint: number;
        effectiveLeadDays: number;
    } | null;
    finalRiskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    confidenceScore: number;
    confidenceLabel: 'high' | 'medium' | 'low';
    explanationFromGpt: boolean;
    generatedAt: Date;
}

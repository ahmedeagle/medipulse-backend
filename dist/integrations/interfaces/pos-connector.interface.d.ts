export interface PosStockEntry {
    posSku: string;
    quantity: number;
    lastSoldAt?: Date;
    dailySales?: number;
}
export interface PosRecommendationPayload {
    recommendationId: string;
    productName: string;
    urgency: 'critical' | 'high' | 'medium';
    suggestedAction: string;
    expiresAt: Date;
}
export interface IPosConnector {
    readonly connectorType: 'pos';
    getRealtimeStock(tenantId: string): Promise<PosStockEntry[]>;
    pushRecommendation(tenantId: string, rec: PosRecommendationPayload): Promise<void>;
    getSalesVelocity(tenantId: string, days: number): Promise<PosStockEntry[]>;
    healthCheck(tenantId: string): Promise<{
        connected: boolean;
        latencyMs: number;
    }>;
}

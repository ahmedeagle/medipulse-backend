/**
 * Integration SDK — POS Connector Interface
 *
 * Connects MediPulse to pharmacy Point-of-Sale systems.
 * POS integration enables real-time stock sync and pushes recommendations
 * directly into the pharmacist's workflow tool.
 */

export interface PosStockEntry {
  posSku:        string;
  quantity:      number;
  lastSoldAt?:   Date;
  dailySales?:   number;
}

export interface PosRecommendationPayload {
  recommendationId: string;
  productName:      string;
  urgency:          'critical' | 'high' | 'medium';
  suggestedAction:  string;
  expiresAt:        Date;
}

export interface IPosConnector {
  readonly connectorType: 'pos';

  /** Get real-time stock levels from the POS system */
  getRealtimeStock(tenantId: string): Promise<PosStockEntry[]>;

  /** Push a procurement recommendation into the POS for pharmacist review */
  pushRecommendation(tenantId: string, rec: PosRecommendationPayload): Promise<void>;

  /** Fetch recent sales velocity (last 30 days) per SKU */
  getSalesVelocity(tenantId: string, days: number): Promise<PosStockEntry[]>;

  healthCheck(tenantId: string): Promise<{ connected: boolean; latencyMs: number }>;
}

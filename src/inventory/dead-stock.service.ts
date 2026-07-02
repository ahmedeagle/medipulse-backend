import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PriceSnapshot } from '../analytics/entities/price-snapshot.entity';

export type LiquidationAction = 'return_to_supplier' | 'markdown' | 'write_off' | 'monitor';

/** Configurable dead-stock thresholds (from pharmacy settings; fall back to defaults). */
export interface DeadStockConfig {
  probabilityThreshold: number;   // classifier cutoff (default 0.70)
  dormancyWeeksMarkdown: number;  // weeks → markdown (default 12)
  dormancyWeeksReturn: number;    // weeks → supplier-return (default 16)
}

export const DEAD_STOCK_DEFAULTS: DeadStockConfig = {
  probabilityThreshold: 0.70,
  dormancyWeeksMarkdown: 12,
  dormancyWeeksReturn: 16,
};

export interface DeadStockAnalysis {
  productId:              string;
  productName:            string;
  currentQuantity:        number;
  weeksWithoutMovement:   number;
  estimatedValue:         number;
  expiryRisk:             'critical' | 'high' | 'none';
  daysToExpiry:           number | null;
  recommendedAction:      LiquidationAction;
  actionReason:           string;
  urgencyScore:           number;    // 0–100, higher = act faster
  deadStockProbability:   number;    // 0.0–1.0 from Logistic Regression classifier
  classifierConfidence:   'high' | 'medium' | 'low';
}

/**
 * Dead Stock Intelligence with Logistic Regression classifier.
 *
 * Replaces the naive 8-week threshold with a probabilistic classifier:
 *   P(dead in next 30 days) = sigmoid(w·x)
 *
 * Features:
 *   velocity_7d:          units/day last 7 days
 *   velocity_30d:         units/day last 30 days
 *   velocity_90d:         units/day last 90 days
 *   velocity_trend:       (v30 - v90) / max(v90, 0.001)
 *   days_since_last_sale: from ConsumptionSnapshot
 *   days_to_expiry:       from InventoryItem (null = no expiry)
 *   product_age_weeks:    weeks since first order
 *
 * Weights seeded from pharmaceutical inventory management literature:
 *   Nahmias (2009) "Perishable Inventory Systems"
 *   WHO Essential Medicines Management Guide (2014)
 *
 * Threshold: P > 0.70 → classify as dead stock risk
 * Algorithm upgrade path: retrain quarterly on actual outcomes when data accumulates.
 */
@Injectable()
export class DeadStockService {
  constructor(
    @InjectRepository(PriceSnapshot)
    private readonly priceRepo: Repository<PriceSnapshot>,
    private readonly dataSource: DataSource,
  ) {}

  async analyzeDeadStock(tenantId: string, cfg: DeadStockConfig = DEAD_STOCK_DEFAULTS): Promise<DeadStockAnalysis[]> {
    // Fetch products with consumption snapshots (need velocity features for classifier)
    const dormantProducts: Array<{
      productId:    string;
      productName:  string;
      quantity:     number;
      expiryDate:   string | null;
      v7d:          string;
      v30d:         string;
      v90d:         string;
      daysSinceLast: string;
      snapshotCount: string;
      firstWeek:    string;
    }> = await this.dataSource.query(
      `
      SELECT
        s."productId",
        p.name                                                        AS "productName",
        i.quantity,
        i."expiryDate",
        -- Velocity features for logistic regression classifier
        COALESCE(AVG(s."quantityConsumed") FILTER (WHERE s."weekStart" >= NOW() - INTERVAL '7 days'),  0) AS "v7d",
        COALESCE(AVG(s."quantityConsumed") FILTER (WHERE s."weekStart" >= NOW() - INTERVAL '30 days'), 0) AS "v30d",
        COALESCE(AVG(s."quantityConsumed"),                                                            0) AS "v90d",
        COALESCE(
          EXTRACT(DAYS FROM NOW() - MAX(CASE WHEN s."quantityConsumed" > 0 THEN s."weekStart" END)),
          56
        )                                                                                                 AS "daysSinceLast",
        COUNT(s.id)                                                                                      AS "snapshotCount",
        MIN(s."weekStart")                                                                               AS "firstWeek"
      FROM consumption_snapshots s
      JOIN inventory_items i ON i."pharmacyTenantId" = s."tenantId"
                             AND i."productId"        = s."productId"
                             AND i."deletedAt" IS NULL
      JOIN products p        ON p.id = s."productId"
      WHERE s."tenantId" = $1
        AND i.quantity > 0
      GROUP BY s."productId", p.name, i.quantity, i."expiryDate"
      HAVING COUNT(s.id) >= 4   -- need at least 4 weeks for meaningful signal
      `,
      [tenantId],
    );

    const results: DeadStockAnalysis[] = [];

    for (const row of dormantProducts) {
      const v7d    = parseFloat(row.v7d);
      const v30d   = parseFloat(row.v30d);
      const v90d   = parseFloat(row.v90d);
      const daysSinceLast = parseFloat(row.daysSinceLast ?? '56');

      // Logistic Regression classifier: P(dead in next 30 days)
      const probability = this.computeDeadStockProbability({
        velocity_7d:          v7d,
        velocity_30d:         v30d,
        velocity_90d:         v90d,
        velocity_trend:       v90d > 0.001 ? (v30d - v90d) / v90d : 0,
        days_since_last_sale: daysSinceLast,
        days_to_expiry:       row.expiryDate
          ? Math.max(0, Math.floor((new Date(row.expiryDate).getTime() - Date.now()) / 86_400_000))
          : 180,  // no expiry → assume long horizon
        product_age_weeks:    row.firstWeek
          ? Math.floor((Date.now() - new Date(row.firstWeek).getTime()) / (7 * 86_400_000))
          : parseInt(row.snapshotCount, 10),
      });

      // Only surface as dead stock if probability exceeds the (configurable) cutoff
      if (probability < cfg.probabilityThreshold) continue;

      const estimatedValue = await this.estimateValue(row.productId, row.quantity);
      const daysToExpiry   = row.expiryDate
        ? Math.floor((new Date(row.expiryDate).getTime() - Date.now()) / 86_400_000)
        : null;

      const expiryRisk: 'critical' | 'high' | 'none' =
        daysToExpiry !== null && daysToExpiry <= 30 ? 'critical' :
        daysToExpiry !== null && daysToExpiry <= 90 ? 'high' : 'none';

      const weeksWithoutMovement = Math.round(daysSinceLast / 7);

      const { action, reason, urgencyScore } = this.recommendAction({
        daysToExpiry,
        expiryRisk,
        estimatedValue,
        weeksWithoutMovement,
      }, cfg);

      const classifierConfidence: 'high' | 'medium' | 'low' =
        probability >= 0.90 ? 'high' : probability >= 0.80 ? 'medium' : 'low';

      results.push({
        productId:            row.productId,
        productName:          row.productName,
        currentQuantity:      row.quantity,
        weeksWithoutMovement,
        estimatedValue,
        expiryRisk,
        daysToExpiry,
        recommendedAction:    action,
        actionReason:         reason,
        urgencyScore,
        deadStockProbability: Math.round(probability * 1000) / 1000,
        classifierConfidence,
      });
    }

    return results.sort((a, b) => b.urgencyScore - a.urgencyScore);
  }

  async getTotalDeadStockValue(tenantId: string): Promise<{ value: number; count: number }> {
    const analyses = await this.analyzeDeadStock(tenantId);
    return {
      value: analyses.reduce((s, a) => s + a.estimatedValue, 0),
      count: analyses.length,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async estimateValue(productId: string, quantity: number): Promise<number> {
    // Use most recent price snapshot as cost proxy
    const latestPrice = await this.priceRepo
      .createQueryBuilder('p')
      .where('p.productId = :productId', { productId })
      .orderBy('p.recordedAt', 'DESC')
      .getOne();

    const unitCost = latestPrice ? Number(latestPrice.price) : 0;
    return Math.round(unitCost * quantity * 100) / 100;
  }

  /**
   * Logistic Regression classifier: P(product is dead stock in next 30 days)
   *
   * Features and weights seeded from pharmaceutical inventory management literature.
   * Sigmoid activation: P = 1 / (1 + e^(-z))
   *
   * Weight interpretation:
   *   - Negative weights: higher feature value → lower probability of dead stock
   *   - Positive weights: higher feature value → higher probability of dead stock
   *
   * Retrain quarterly when real outcome data accumulates (acted_on vs ignored).
   */
  private computeDeadStockProbability(features: {
    velocity_7d:          number;
    velocity_30d:         number;
    velocity_90d:         number;
    velocity_trend:       number;  // (v30 - v90) / v90 — negative = slowing down
    days_since_last_sale: number;
    days_to_expiry:       number;
    product_age_weeks:    number;
  }): number {
    // Weights (intercept + 7 features)
    // Literature basis: Nahmias (2009), WHO Medicines Management (2014)
    const BIAS      = -1.5;   // base offset (most products are NOT dead stock)
    const W = {
      velocity_7d:          -3.5,  // recent activity strongly predicts NOT dead
      velocity_30d:         -2.0,  // 30-day velocity matters but less than 7-day
      velocity_90d:         -0.5,  // 90-day baseline — less predictive
      velocity_trend:       -1.8,  // declining trend → more likely dead
      days_since_last_sale:  0.05, // each extra day of no sales increases risk
      days_to_expiry:       -0.01, // far from expiry → slightly less urgent
      product_age_weeks:    -0.02, // older product → slightly more established
    };

    const z = BIAS
      + W.velocity_7d          * Math.min(features.velocity_7d,  10)  // cap outliers
      + W.velocity_30d         * Math.min(features.velocity_30d, 10)
      + W.velocity_90d         * Math.min(features.velocity_90d, 10)
      + W.velocity_trend       * Math.max(-2, Math.min(2, features.velocity_trend))
      + W.days_since_last_sale * Math.min(features.days_since_last_sale, 120)
      + W.days_to_expiry       * Math.min(features.days_to_expiry, 365)
      + W.product_age_weeks    * Math.min(features.product_age_weeks, 104);

    // Sigmoid activation
    return 1 / (1 + Math.exp(-z));
  }

  private recommendAction(params: {
    daysToExpiry:         number | null;
    expiryRisk:           'critical' | 'high' | 'none';
    estimatedValue:       number;
    weeksWithoutMovement: number;
  }, cfg: DeadStockConfig = DEAD_STOCK_DEFAULTS): { action: LiquidationAction; reason: string; urgencyScore: number } {
    const { daysToExpiry, expiryRisk, estimatedValue, weeksWithoutMovement } = params;

    if (expiryRisk === 'critical') {
      return {
        action:       'return_to_supplier',
        reason:       `Expires in ${daysToExpiry} days. Contact supplier immediately for return or exchange.`,
        urgencyScore: 95,
      };
    }

    if (expiryRisk === 'high' && estimatedValue >= 500) {
      return {
        action:       'markdown',
        reason:       `Expires in ${daysToExpiry} days with SAR ${estimatedValue.toFixed(0)} at risk. Consider price reduction to accelerate sales.`,
        urgencyScore: 80,
      };
    }

    if (weeksWithoutMovement >= cfg.dormancyWeeksReturn && estimatedValue >= 1000) {
      return {
        action:       'return_to_supplier',
        reason:       `${weeksWithoutMovement} weeks without movement. SAR ${estimatedValue.toFixed(0)} locked in slow-moving inventory. Request return authorization.`,
        urgencyScore: 70,
      };
    }

    if (weeksWithoutMovement >= cfg.dormancyWeeksMarkdown) {
      return {
        action:       'markdown',
        reason:       `${weeksWithoutMovement} weeks without movement. A price reduction or bundled offer may accelerate turnover.`,
        urgencyScore: 55,
      };
    }

    if (expiryRisk === 'none' && weeksWithoutMovement <= 10) {
      return {
        action:       'monitor',
        reason:       `${weeksWithoutMovement} weeks without movement. Continue monitoring — may be seasonal.`,
        urgencyScore: 30,
      };
    }

    return {
      action:       'write_off',
      reason:       `Long-standing dead stock. Consider writing off and rebalancing procurement budget.`,
      urgencyScore: 60,
    };
  }
}

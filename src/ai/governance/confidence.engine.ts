export type ConfidenceLabel = 'high' | 'medium' | 'low';

export interface ConfidenceScore {
  score: number;          // 0.0 – 1.0
  label: ConfidenceLabel;
  factors: Record<string, number>;
}

/**
 * Scores how reliable a recommendation is based on data quality.
 *
 * Score is NOT a probability — it is a transparency signal for the user:
 * "how much real data backs this suggestion?"
 *
 * Factors:
 *  - historyDays: how many days of order history exist (0–90)
 *  - trendStability: stable trend = higher confidence
 *  - seasonalCoverage: seasonal rule was triggered with a known multiplier
 *  - supplierAvailability: at least one supplier has the product
 */
export class ConfidenceEngine {
  compute(params: {
    historyDays: number;           // days of order history available (0–90)
    trend: 'increasing' | 'stable' | 'decreasing';
    seasonalMultiplier: number;    // 0 = no seasonal rule applied
    suppliersAvailable: number;    // count of available supplier listings
    currentQuantity: number;
    minThreshold: number;
  }): ConfidenceScore {
    const factors: Record<string, number> = {};

    // History depth: 0–90 days → 0.0–0.40
    factors.historyDepth = Math.min(params.historyDays / 90, 1) * 0.40;

    // Trend stability: stable = full 0.25, changing = 0.15
    factors.trendStability = params.trend === 'stable' ? 0.25 : 0.15;

    // Seasonal coverage: rule applied = +0.15, no rule = 0.10
    factors.seasonalCoverage = params.seasonalMultiplier > 0 ? 0.15 : 0.10;

    // Supplier availability: at least one = 0.20, none = 0.00
    factors.supplierAvailability = params.suppliersAvailable > 0 ? 0.20 : 0.00;

    const score = Math.min(
      Object.values(factors).reduce((sum, v) => sum + v, 0),
      1.0,
    );

    const rounded = Math.round(score * 100) / 100;

    return {
      score: rounded,
      label: this.toLabel(rounded),
      factors,
    };
  }

  private toLabel(score: number): ConfidenceLabel {
    if (score >= 0.70) return 'high';
    if (score >= 0.40) return 'medium';
    return 'low';
  }
}

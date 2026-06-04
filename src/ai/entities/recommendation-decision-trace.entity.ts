import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Full explanation audit trail for every AI recommendation.
 *
 * This is what an enterprise pharmacy director, SFDA auditor, or investor
 * will ask to see: "Why did the system recommend ordering 200 units of Amoxicillin?"
 *
 * The trace answers:
 *   - Which rules fired (and which didn't)
 *   - What supplier scores were considered
 *   - What demand forecast was used
 *   - What seasonal event (Hajj/Ramadan/school) was active
 *   - What the final confidence score was
 *
 * This is also the data needed to detect model drift:
 *   - If pharmacists override >40% of a specific rule → recalibrate
 *   - If Hajj multiplier correlates with acted_on rate → multiplier is correct
 *   - If forecasts consistently over/under-estimate → adjust α/β parameters
 */
@Entity('recommendation_decision_traces')
@Index(['recommendationId'], { unique: true })
@Index(['tenantId', 'generatedAt'])
export class RecommendationDecisionTrace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  recommendationId: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /**
   * Every rule that was evaluated, whether it triggered, and how much it contributed.
   * Example:
   * [
   *   { rule: 'REORDER', triggered: true, contribution: 'stock_45 < rop_87' },
   *   { rule: 'FORECAST_ALERT', triggered: true, contribution: 'forecast_180 > pace_95 * 1.30' },
   *   { rule: 'DEAD_STOCK', triggered: false, contribution: 'classifier_p=0.02 < 0.70' }
   * ]
   */
  @Column({ type: 'jsonb', default: [] })
  rulesEvaluated: Array<{
    rule:        string;
    triggered:   boolean;
    contribution: string;
    weight?:     number;
  }>;

  /**
   * Supplier scores that were factored into the recommendation selection.
   */
  @Column({ type: 'jsonb', default: [] })
  supplierScoresConsidered: Array<{
    supplierTenantId: string;
    score:            number;
    rank:             number;
    wasSelected:      boolean;
  }>;

  /**
   * Demand forecast that informed the recommended quantity.
   */
  @Column({ type: 'jsonb', nullable: true })
  forecastUsed: {
    algorithm:      string;
    forecastedQty:  number;
    confidence:     number;
    horizonDays:    number;
    trainingPoints: number;
  } | null;

  /**
   * Hijri calendar event active at generation time.
   * source = 'none' means no seasonal adjustment was applied.
   */
  @Column({ type: 'jsonb', nullable: true })
  seasonalSignal: {
    event:      string | null;  // e.g. "موسم الحج"
    source:     string;         // 'hajj' | 'ramadan' | 'school_return' | 'none'
    multiplier: number;         // 1.35 = +35% demand
    category:   string;         // product category the multiplier applied to
  } | null;

  /** EOQ parameters used for quantity calculation, if available */
  @Column({ type: 'jsonb', nullable: true })
  eoqUsed: {
    eoqQty:           number;
    safetyStockQty:   number;
    reorderPoint:     number;
    effectiveLeadDays: number;
  } | null;

  @Column({ type: 'varchar', length: 10 })
  finalRiskLevel: 'HIGH' | 'MEDIUM' | 'LOW';

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  confidenceScore: number;

  @Column({ type: 'varchar', length: 10 })
  confidenceLabel: 'high' | 'medium' | 'low';

  @Column({ type: 'boolean', default: false })
  explanationFromGpt: boolean;

  @CreateDateColumn()
  generatedAt: Date;
}

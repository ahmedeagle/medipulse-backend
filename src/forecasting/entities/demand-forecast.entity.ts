import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Stores demand forecasts per product per pharmacy.
 * Generated weekly by DemandForecastingService using Holt-Winters Double Exponential Smoothing.
 *
 * Architecture note: The algorithm is swappable — when sufficient data accumulates (12+ months)
 * this service can be replaced with Prophet/ARIMA/LSTM without changing any consumers.
 * The interface (forecastedQty, confidenceIntervalLow/High, horizon) stays identical.
 */
@Entity('demand_forecasts')
@Index(['tenantId', 'productId', 'forecastDate'], { unique: true })
@Index(['tenantId', 'productId'])
export class DemandForecast {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  productId: string;

  /** The Monday of the week this forecast was generated */
  @Column({ type: 'date' })
  forecastDate: Date;

  /** Forecast horizon in days (7, 14, 30) */
  @Column({ type: 'int' })
  horizonDays: number;

  /** Predicted total quantity needed over the horizon */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  forecastedQty: number;

  /** Lower bound of 90% confidence interval */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  confidenceIntervalLow: number;

  /** Upper bound of 90% confidence interval */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  confidenceIntervalHigh: number;

  /** Estimated daily demand used to build this forecast */
  @Column({ type: 'decimal', precision: 8, scale: 4 })
  estimatedDailyDemand: number;

  /** Detected trend direction */
  @Column({ type: 'varchar', length: 20, default: 'stable' })
  trend: 'increasing' | 'stable' | 'decreasing';

  /** Smoothed trend magnitude (units per day) */
  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  trendMagnitude: number;

  /** Algorithm used — allows tracking when engine is upgraded */
  @Column({ type: 'varchar', length: 50, default: 'holt-winters-double' })
  algorithm: string;

  /** Number of data points used to train this forecast */
  @Column({ type: 'int', default: 0 })
  trainingDataPoints: number;

  /** Actual quantity consumed over the horizon (filled in retrospectively) */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  actualQty: number;

  /** Mean Absolute Percentage Error vs actual (filled in retrospectively) */
  @Column({ type: 'decimal', precision: 6, scale: 4, nullable: true })
  mapeError: number;

  @CreateDateColumn()
  createdAt: Date;
}

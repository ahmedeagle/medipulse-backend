import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * prophet_forecast_comparison — SHADOW-MODE evaluation log.
 *
 * For each forecast the in-process Holt-Winters engine produces, we may ALSO
 * (when shadow mode is enabled) ask the external Prophet microservice for its
 * forecast and record both side-by-side here. This table NEVER feeds the
 * product/reorder logic — it exists purely to measure, over many weeks, whether
 * Prophet beats Holt-Winters per product before we ever consider activating it.
 *
 * `actualQty` / MAPE columns are filled retrospectively (like demand_forecasts)
 * so we can compare real accuracy, not just point-estimate divergence.
 */
@Entity('prophet_forecast_comparison')
@Index(['tenantId', 'productId', 'forecastDate', 'horizonDays'], { unique: true })
@Index(['tenantId', 'productId'])
export class ProphetForecastComparison {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'date' })
  forecastDate: Date;

  @Column({ type: 'int' })
  horizonDays: number;

  // ── Holt-Winters (the live engine) ─────────────────────────────────────────
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  holtQty: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  holtCiLow: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  holtCiHigh: number | null;

  // ── Prophet (shadow candidate) ─────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  prophetQty: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  prophetCiLow: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  prophetCiHigh: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  prophetTrend: string | null;

  @Column({ type: 'int', default: 0 })
  trainingDataPoints: number;

  /** |prophet - holt| / max(holt,1) — point-estimate divergence at write time. */
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  diffRatio: number | null;

  // ── Retrospective accuracy (filled ~4 weeks later) ─────────────────────────
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  actualQty: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 4, nullable: true })
  holtMape: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 4, nullable: true })
  prophetMape: number | null;

  /** shadow | prophet_better | holt_better — set during accuracy backfill. */
  @Column({ type: 'varchar', length: 20, default: 'shadow' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}

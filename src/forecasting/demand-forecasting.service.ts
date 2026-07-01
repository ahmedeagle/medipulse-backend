import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { DemandForecast } from './entities/demand-forecast.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { TenantType } from '../common/enums/tenant-type.enum';
import { ProphetShadowService } from './prophet-shadow.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

/**
 * Holt-Winters Double Exponential Smoothing (Holt's Linear)
 *
 * Handles both level and trend components of demand.
 * Seasonal component is handled separately by the SeasonalityEngine.
 *
 * Parameters (tuned for weekly pharmacy demand data):
 *   α = 0.4  — level smoothing (moderate responsiveness to recent data)
 *   β = 0.15 — trend smoothing (slow trend adaptation — pharmaceutical demand trends slowly)
 *
 * Upgrade path: When 12+ months of data exists, replace this with:
 *   - Prophet (Facebook) for automated seasonality detection
 *   - ARIMA for stationary series
 *   - LSTM for complex non-linear patterns
 * The interface (forecastedQty, CI, horizon) stays identical.
 */

const ALPHA = 0.4;   // level smoothing
const BETA  = 0.15;  // trend smoothing
const Z_95  = 1.645; // z-score for 95% confidence interval
const HORIZONS = [7, 14, 30];
const MIN_DATA_POINTS = 4;

export interface ForecastResult {
  forecastedQty:          number;
  confidenceIntervalLow:  number;
  confidenceIntervalHigh: number;
  estimatedDailyDemand:   number;
  trend:                  'increasing' | 'stable' | 'decreasing';
  trendMagnitude:         number;
  trainingDataPoints:     number;
}

@Injectable()
export class DemandForecastingService {
  private readonly logger = new Logger(DemandForecastingService.name);

  constructor(
    @InjectRepository(DemandForecast)
    private readonly forecastRepo: Repository<DemandForecast>,
    @InjectRepository(ConsumptionSnapshot)
    private readonly snapshotRepo: Repository<ConsumptionSnapshot>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly prophetShadow: ProphetShadowService,
    private readonly cronLock: CronLockService,
  ) {}

  // ─── Weekly cron: compute forecasts for all pharmacy-product pairs ────────

  @Cron('0 6 * * 0') // Sunday 6am — after consumption snapshots are computed
  async computeAllForecasts(): Promise<void> {
    // Single-flight across HTTP + worker processes/pods — only one runs.
    const acquired = await this.cronLock.acquire('demand_forecast_weekly');
    if (!acquired) {
      this.logger.log('Demand forecast computation skipped (lock held by another process)');
      return;
    }

    this.logger.log('Demand forecast computation started');

    const pharmacies = await this.tenantRepo.find({
      where: { type: TenantType.PHARMACY, isActive: true },
    });

    let computed = 0;
    for (const pharmacy of pharmacies) {
      computed += await this.computeForecasts(pharmacy.id);
    }

    this.logger.log(`Demand forecasts computed — ${computed} product-pharmacy pairs`);
  }

  async computeForecasts(tenantId: string): Promise<number> {
    // Get distinct product IDs for this pharmacy
    const products = await this.snapshotRepo
      .createQueryBuilder('s')
      .select('DISTINCT s.productId', 'productId')
      .where('s.tenantId = :tenantId', { tenantId })
      .getRawMany<{ productId: string }>();

    const weekStart = this.getLastMonday();
    let count = 0;

    for (const { productId } of products) {
      const snapshots = await this.snapshotRepo
        .createQueryBuilder('s')
        .where('s.tenantId = :tenantId', { tenantId })
        .andWhere('s.productId = :productId', { productId })
        .orderBy('s.weekStart', 'ASC')
        .take(26)  // last 6 months max
        .getMany();

      if (snapshots.length < MIN_DATA_POINTS) continue;

      let result14: ForecastResult | null = null;
      for (const horizonDays of HORIZONS) {
        const result = this.holtsLinearForecast(snapshots, horizonDays);
        await this.upsertForecast(tenantId, productId, weekStart, horizonDays, result);
        if (horizonDays === 14) result14 = result;
        count++;
      }

      // Trust-gated shadow evaluation (no-op unless explicitly enabled).
      // Never affects the persisted Holt-Winters forecast above.
      if (result14 && this.prophetShadow.isEnabled()) {
        await this.prophetShadow.compareInShadow(
          tenantId,
          productId,
          weekStart,
          14,
          snapshots,
          result14,
        );
      }
    }

    return count;
  }

  // ─── Core algorithm: Holt's Linear (Double Exponential Smoothing) ─────────

  holtsLinearForecast(
    snapshots: ConsumptionSnapshot[],
    horizonDays: number,
  ): ForecastResult {
    const weeklyQty = snapshots.map((s) => s.quantityConsumed);
    const n = weeklyQty.length;

    // Initialise level and trend using first two observations
    let L = weeklyQty[0];
    let T = n >= 2 ? (weeklyQty[1] - weeklyQty[0]) : 0;

    const residuals: number[] = [];

    for (let i = 1; i < n; i++) {
      const y    = weeklyQty[i];
      const Lprev = L;
      L = ALPHA * y + (1 - ALPHA) * (L + T);
      T = BETA  * (L - Lprev) + (1 - BETA) * T;
      residuals.push(Math.abs(y - (Lprev + T)));
    }

    // Forecast h weeks ahead (convert horizon days to weeks)
    const h = horizonDays / 7;
    const forecastedWeeklyQty = Math.max(0, L + h * T);
    const forecastedQty       = Math.round(forecastedWeeklyQty * 10) / 10;

    // 90% CI using residual standard deviation
    const mae = residuals.length
      ? residuals.reduce((a, b) => a + b, 0) / residuals.length
      : forecastedQty * 0.2;
    const ciHalfWidth = Z_95 * mae * Math.sqrt(h);

    const avgWeeklyQty   = weeklyQty.reduce((a, b) => a + b, 0) / n;
    const dailyDemand    = (L + T) / 7;
    const trendMagnitude = Math.abs(T / 7);  // units per day

    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (T > avgWeeklyQty * 0.1 / 7)      trend = 'increasing';
    else if (T < -avgWeeklyQty * 0.1 / 7) trend = 'decreasing';

    return {
      forecastedQty,
      confidenceIntervalLow:  Math.max(0, Math.round((forecastedQty - ciHalfWidth) * 10) / 10),
      confidenceIntervalHigh: Math.round((forecastedQty + ciHalfWidth) * 10) / 10,
      estimatedDailyDemand:   Math.round(dailyDemand * 1000) / 1000,
      trend,
      trendMagnitude:         Math.round(trendMagnitude * 1000) / 1000,
      trainingDataPoints:     n,
    };
  }

  // ─── Read API ─────────────────────────────────────────────────────────────

  async getForecasts(
    tenantId: string,
    productId: string,
  ): Promise<DemandForecast[]> {
    const weekStart = this.getLastMonday();
    return this.forecastRepo
      .createQueryBuilder('f')
      .where('f.tenantId = :tenantId', { tenantId })
      .andWhere('f.productId = :productId', { productId })
      .andWhere('f.forecastDate = :weekStart', { weekStart })
      .orderBy('f.horizonDays', 'ASC')
      .getMany();
  }

  async getForecastMap(
    tenantId: string,
    productIds: string[],
    horizonDays = 14,
  ): Promise<Map<string, DemandForecast>> {
    if (!productIds.length) return new Map();
    const weekStart = this.getLastMonday();
    const forecasts = await this.forecastRepo
      .createQueryBuilder('f')
      .where('f.tenantId = :tenantId', { tenantId })
      .andWhere('f.productId IN (:...productIds)', { productIds })
      .andWhere('f.horizonDays = :horizonDays', { horizonDays })
      .andWhere('f.forecastDate = :weekStart', { weekStart })
      .getMany();
    return new Map(forecasts.map((f) => [f.productId, f]));
  }

  // ─── Retrospective accuracy tracking ─────────────────────────────────────

  @Cron('0 7 * * 0')  // Sunday 7am — after forecasts are computed
  async updateAccuracy(): Promise<void> {
    // Find forecasts from 4 weeks ago (14-day horizon) that now have actuals
    const fourWeeksAgo = new Date(Date.now() - 28 * 86_400_000);
    const oldForecasts = await this.forecastRepo
      .createQueryBuilder('f')
      .where('f.horizonDays = 14')
      .andWhere('f.actualQty IS NULL')
      .andWhere('f.forecastDate <= :cutoff', { cutoff: fourWeeksAgo })
      .take(500)
      .getMany();

    for (const forecast of oldForecasts) {
      const actual = await this.snapshotRepo
        .createQueryBuilder('s')
        .where('s.tenantId = :tenantId', { tenantId: forecast.tenantId })
        .andWhere('s.productId = :productId', { productId: forecast.productId })
        .andWhere('s.weekStart >= :from', { from: forecast.forecastDate })
        .andWhere('s.weekStart < :to', {
          to: new Date(forecast.forecastDate.getTime() + 14 * 86_400_000),
        })
        .getMany();

      if (!actual.length) continue;

      const actualQty = actual.reduce((s, r) => s + r.quantityConsumed, 0);
      const mapeError = forecast.forecastedQty > 0
        ? Math.abs(actualQty - Number(forecast.forecastedQty)) / Number(forecast.forecastedQty)
        : null;

      await this.forecastRepo.update(forecast.id, { actualQty, mapeError });
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async upsertForecast(
    tenantId: string,
    productId: string,
    forecastDate: Date,
    horizonDays: number,
    result: ForecastResult,
  ): Promise<void> {
    const existing = await this.forecastRepo.findOne({
      where: { tenantId, productId, forecastDate, horizonDays },
    });

    const payload = {
      tenantId,
      productId,
      forecastDate,
      horizonDays,
      algorithm: 'holt-winters-double',
      ...result,
    };

    if (existing) {
      await this.forecastRepo.update(existing.id, payload);
    } else {
      await this.forecastRepo.save(this.forecastRepo.create(payload));
    }
  }

  private getLastMonday(): Date {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

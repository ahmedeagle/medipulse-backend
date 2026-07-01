import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { ProphetForecastComparison } from './entities/prophet-forecast-comparison.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import type { ForecastResult } from './demand-forecasting.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

/**
 * ProphetShadowService — TRUST-GATED shadow evaluation of an external Prophet
 * forecasting microservice.
 *
 * Design principles (never break the live engine):
 *   • Disabled by default. Only runs when PROPHET_SHADOW_ENABLED is truthy AND
 *     PROPHET_MICROSERVICE_URL is set.
 *   • Pure observer: it NEVER writes to demand_forecasts and NEVER influences
 *     reorder / EOQ / procurement logic. It only logs to its own comparison table.
 *   • Fail-safe: any network/parse error is swallowed — the live Holt-Winters
 *     forecast is already persisted before we even ask Prophet.
 *   • Per-product accuracy is backfilled weeks later so we can prove (or disprove)
 *     that Prophet beats Holt-Winters BEFORE anyone considers activating it.
 */
@Injectable()
export class ProphetShadowService {
  private readonly logger = new Logger(ProphetShadowService.name);

  constructor(
    @InjectRepository(ProphetForecastComparison)
    private readonly cmpRepo: Repository<ProphetForecastComparison>,
    @InjectRepository(ConsumptionSnapshot)
    private readonly snapshotRepo: Repository<ConsumptionSnapshot>,
    private readonly config: ConfigService,
    private readonly cronLock: CronLockService,
  ) {}

  isEnabled(): boolean {
    const flag = (this.config.get<string>('PROPHET_SHADOW_ENABLED') ?? '')
      .toLowerCase()
      .trim();
    const enabled = flag === 'true' || flag === '1' || flag === 'yes';
    return enabled && !!this.serviceUrl();
  }

  private serviceUrl(): string | undefined {
    const url = this.config.get<string>('PROPHET_MICROSERVICE_URL');
    return url && url.trim() ? url.trim().replace(/\/+$/, '') : undefined;
  }

  /**
   * Best-effort shadow comparison. Called from computeForecasts AFTER the live
   * Holt-Winters forecast is already persisted. Always resolves; never throws.
   */
  async compareInShadow(
    tenantId: string,
    productId: string,
    forecastDate: Date,
    horizonDays: number,
    snapshots: ConsumptionSnapshot[],
    holt: ForecastResult,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const url = this.serviceUrl();
    if (!url) return;

    try {
      const series = snapshots
        .map((s) => ({
          ds: this.toIsoDate(s.weekStart),
          y: Number(s.quantityConsumed) || 0,
        }))
        .filter((p) => !!p.ds);

      if (series.length < 4) return;

      const resp = await axios.post(
        `${url}/forecast`,
        { series, horizonDays },
        {
          timeout: 10_000,
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
        },
      );

      if (resp.status < 200 || resp.status >= 300 || !resp.data) return;

      const p = resp.data as Partial<ForecastResult>;
      const prophetQty = this.num(p.forecastedQty);
      if (prophetQty === null) return;

      const holtQty = this.num(holt.forecastedQty) ?? 0;
      const diffRatio =
        holtQty > 0 ? Math.abs(prophetQty - holtQty) / holtQty : null;

      await this.cmpRepo
        .createQueryBuilder()
        .insert()
        .into(ProphetForecastComparison)
        .values({
          tenantId,
          productId,
          forecastDate,
          horizonDays,
          holtQty,
          holtCiLow: this.num(holt.confidenceIntervalLow),
          holtCiHigh: this.num(holt.confidenceIntervalHigh),
          prophetQty,
          prophetCiLow: this.num(p.confidenceIntervalLow),
          prophetCiHigh: this.num(p.confidenceIntervalHigh),
          prophetTrend: typeof p.trend === 'string' ? p.trend : null,
          trainingDataPoints: this.num(p.trainingDataPoints) ?? series.length,
          diffRatio: diffRatio === null ? null : Math.round(diffRatio * 10000) / 10000,
          status: 'shadow',
        })
        .orUpdate(
          [
            'holtQty',
            'holtCiLow',
            'holtCiHigh',
            'prophetQty',
            'prophetCiLow',
            'prophetCiHigh',
            'prophetTrend',
            'trainingDataPoints',
            'diffRatio',
          ],
          ['tenantId', 'productId', 'forecastDate', 'horizonDays'],
        )
        .execute();
    } catch (err) {
      // Fail-safe: the live forecast is unaffected. Log at debug only.
      this.logger.debug(
        `Prophet shadow compare skipped for product ${productId}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Backfill retrospective accuracy for 14-day shadow comparisons that are now
   * ~4 weeks old. Lets us measure which engine was actually closer to reality.
   * Runs after the live updateAccuracy cron (Sunday 7am) — Sunday 7:30am.
   */
  @Cron('30 7 * * 0')
  async updateShadowAccuracy(): Promise<void> {
    if (!this.isEnabled()) return;

    // Single-flight across HTTP + worker processes/pods — only one runs.
    const acquired = await this.cronLock.acquire('prophet_shadow_accuracy_weekly');
    if (!acquired) return;

    const fourWeeksAgo = new Date(Date.now() - 28 * 86_400_000);
    const pending = await this.cmpRepo
      .createQueryBuilder('c')
      .where('c.horizonDays = 14')
      .andWhere('c.actualQty IS NULL')
      .andWhere('c.forecastDate <= :cutoff', { cutoff: fourWeeksAgo })
      .take(500)
      .getMany();

    for (const row of pending) {
      try {
        const actuals = await this.snapshotRepo
          .createQueryBuilder('s')
          .where('s.tenantId = :tenantId', { tenantId: row.tenantId })
          .andWhere('s.productId = :productId', { productId: row.productId })
          .andWhere('s.weekStart >= :from', { from: row.forecastDate })
          .andWhere('s.weekStart < :to', {
            to: new Date(new Date(row.forecastDate).getTime() + 14 * 86_400_000),
          })
          .getMany();

        if (!actuals.length) continue;

        const actualQty = actuals.reduce((a, r) => a + r.quantityConsumed, 0);
        const holtMape = this.mape(actualQty, Number(row.holtQty));
        const prophetMape = this.mape(actualQty, Number(row.prophetQty));

        let status = 'shadow';
        if (holtMape !== null && prophetMape !== null) {
          status = prophetMape < holtMape ? 'prophet_better' : 'holt_better';
        }

        await this.cmpRepo.update(row.id, {
          actualQty,
          holtMape,
          prophetMape,
          status,
        });
      } catch {
        // ignore individual row failures
      }
    }
  }

  /**
   * Read-only accuracy summary for one pharmacy. Powers the "AI model validation"
   * card in the UI so admins can SEE that the forecasting engine is continuously
   * benchmarked against Facebook Prophet — and which one is winning.
   *
   * Safe to call even when shadow mode is OFF: it simply reports `enabled: false`
   * with whatever historical comparisons already exist (none, typically).
   */
  async getAccuracySummary(tenantId: string): Promise<{
    enabled: boolean;
    totalComparisons: number;
    evaluated: number;
    holtWins: number;
    prophetWins: number;
    avgHoltMapePct: number | null;
    avgProphetMapePct: number | null;
    recommendation: 'holt_winters' | 'prophet' | 'insufficient_data';
    lastEvaluatedAt: string | null;
  }> {
    const enabled = this.isEnabled();

    const rows = await this.cmpRepo
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .getMany();

    const evaluated = rows.filter(
      (r) => r.holtMape !== null && r.holtMape !== undefined
        && r.prophetMape !== null && r.prophetMape !== undefined,
    );

    const holtWins = evaluated.filter((r) => r.status === 'holt_better').length;
    const prophetWins = evaluated.filter((r) => r.status === 'prophet_better').length;

    const avg = (vals: number[]): number | null =>
      vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 10 : null;

    const avgHoltMapePct = avg(evaluated.map((r) => Number(r.holtMape)).filter((n) => Number.isFinite(n)));
    const avgProphetMapePct = avg(evaluated.map((r) => Number(r.prophetMape)).filter((n) => Number.isFinite(n)));

    let recommendation: 'holt_winters' | 'prophet' | 'insufficient_data' = 'insufficient_data';
    if (evaluated.length >= 20) {
      recommendation = prophetWins > holtWins ? 'prophet' : 'holt_winters';
    }

    const lastEvaluatedAt = rows
      .map((r) => (r.actualQty != null ? new Date((r as any).updatedAt ?? r.forecastDate) : null))
      .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null;

    return {
      enabled,
      totalComparisons: rows.length,
      evaluated: evaluated.length,
      holtWins,
      prophetWins,
      avgHoltMapePct,
      avgProphetMapePct,
      recommendation,
      lastEvaluatedAt,
    };
  }

  private mape(actual: number, predicted: number): number | null {
    if (!predicted || predicted <= 0) return null;
    return Math.round((Math.abs(actual - predicted) / predicted) * 10000) / 10000;
  }

  private num(v: unknown): number | null {
    const n = typeof v === 'string' ? parseFloat(v) : (v as number);
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }

  private toIsoDate(d: Date | string): string {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
  }
}

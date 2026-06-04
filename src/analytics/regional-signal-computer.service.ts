import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { RegionalDemandSignal } from '../inventory/entities/regional-demand-signal.entity';

/**
 * Computes regional demand multipliers from actual anonymized order data.
 *
 * Replaces the "manual seed" approach with data-driven signals once real
 * transaction data accumulates (Phase 3+).
 *
 * Algorithm:
 *   For each (productId, region, month):
 *   1. Aggregate order quantities from all pharmacies in that region in that month
 *   2. Compute the baseline monthly average across all months
 *   3. multiplier = thisMonth / baseline
 *   4. Smooth with existing: 0.7 × computed + 0.3 × existing  (prevents outlier spikes)
 *   5. Clamp to [0.5, 2.0] — no extreme values
 *   6. Mark source = 'computed'
 *
 * Privacy: product-level aggregation only — individual pharmacy data is never exposed.
 * Minimum threshold: need ≥3 pharmacies in region to compute (prevents inference attack).
 */

const SMOOTHING_WEIGHT  = 0.7;   // weight for newly computed vs existing
const MIN_PHARMACIES    = 3;      // minimum pharmacies for meaningful signal
const MAX_MULTIPLIER    = 2.0;    // cap at 100% increase
const MIN_MULTIPLIER    = 0.5;    // floor at 50% decrease

@Injectable()
export class RegionalSignalComputerService {
  private readonly logger = new Logger(RegionalSignalComputerService.name);

  constructor(
    @InjectRepository(RegionalDemandSignal)
    private readonly signalRepo: Repository<RegionalDemandSignal>,
    private readonly dataSource: DataSource,
  ) {}

  /** Monthly cron — 1st of each month at 5am */
  @Cron('0 5 1 * *')
  async computeAllSignals(): Promise<void> {
    this.logger.log('Regional demand signal computation started');

    const currentMonth = new Date().getMonth() + 1;
    const count = await this.computeForMonth(currentMonth);

    this.logger.log(`Regional signals computed — ${count} product-region pairs updated`);
  }

  async computeForMonth(month: number): Promise<number> {
    // Aggregate order quantities by product + pharmacy region for this calendar month
    const rows: Array<{
      productId:      string;
      region:         string;
      pharmacyCount:  string;
      totalQty:       string;
    }> = await this.dataSource.query(
      `
      SELECT
        oi."productId",
        t.region,
        COUNT(DISTINCT o."pharmacyTenantId") AS "pharmacyCount",
        SUM(oi.quantity)                      AS "totalQty"
      FROM order_items oi
      JOIN orders o    ON o.id = oi."orderId"
      JOIN tenants t   ON t.id = o."pharmacyTenantId"
      WHERE o.status = 'delivered'
        AND EXTRACT(MONTH FROM o."updatedAt") = $1
        AND t.region IS NOT NULL
        AND t.region != ''
      GROUP BY oi."productId", t.region
      HAVING COUNT(DISTINCT o."pharmacyTenantId") >= $2
      `,
      [month, MIN_PHARMACIES],
    );

    if (!rows.length) return 0;

    // Get the annual average per product (baseline across all months and regions)
    const baseline: Array<{ productId: string; avgMonthlyQty: string }> =
      await this.dataSource.query(
        `
        SELECT
          oi."productId",
          AVG(monthly_qty) AS "avgMonthlyQty"
        FROM (
          SELECT
            oi."productId",
            EXTRACT(YEAR FROM o."updatedAt")  AS yr,
            EXTRACT(MONTH FROM o."updatedAt") AS mo,
            SUM(oi.quantity)                  AS monthly_qty
          FROM order_items oi
          JOIN orders o ON o.id = oi."orderId"
          WHERE o.status = 'delivered'
          GROUP BY oi."productId", yr, mo
        ) sub
        GROUP BY oi."productId"
        `,
        [],
      );

    const baselineMap = new Map(baseline.map((b) => [
      b.productId,
      parseFloat(b.avgMonthlyQty),
    ]));

    let updated = 0;
    for (const row of rows) {
      const baseline = baselineMap.get(row.productId);
      if (!baseline || baseline === 0) continue;

      const computed = Math.min(
        MAX_MULTIPLIER,
        Math.max(MIN_MULTIPLIER, parseFloat(row.totalQty) / baseline),
      );

      const existing = await this.signalRepo.findOne({
        where: { productId: row.productId, region: row.region, month },
      });

      const smoothed = existing
        ? SMOOTHING_WEIGHT * computed + (1 - SMOOTHING_WEIGHT) * Number(existing.demandMultiplier)
        : computed;

      const finalMultiplier = Math.round(smoothed * 1000) / 1000;

      if (existing) {
        await this.signalRepo.update(existing.id, {
          demandMultiplier: finalMultiplier,
          source: 'computed',
        });
      } else {
        await this.signalRepo.save(
          this.signalRepo.create({
            productId:        row.productId,
            region:           row.region,
            month,
            demandMultiplier: finalMultiplier,
            source:           'computed',
            notes:            `Computed from ${row.pharmacyCount} pharmacies`,
          }),
        );
      }
      updated++;
    }

    return updated;
  }

  async getMultiplier(productId: string, region: string, month: number): Promise<number> {
    if (!region) return 1.0;
    const signal = await this.signalRepo.findOne({ where: { productId, region, month } });
    return signal ? Number(signal.demandMultiplier) : 1.0;
  }
}

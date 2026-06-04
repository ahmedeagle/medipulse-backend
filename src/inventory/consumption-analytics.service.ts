import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConsumptionSnapshot } from './entities/consumption-snapshot.entity';
import { RegionalDemandSignal } from './entities/regional-demand-signal.entity';

@Injectable()
export class ConsumptionAnalyticsService {
  private readonly logger = new Logger(ConsumptionAnalyticsService.name);

  constructor(
    @InjectRepository(ConsumptionSnapshot)
    private readonly snapshotRepo: Repository<ConsumptionSnapshot>,
    @InjectRepository(RegionalDemandSignal)
    private readonly signalRepo: Repository<RegionalDemandSignal>,
    private readonly dataSource: DataSource,
  ) {}

  /** Weekly cron: every Sunday at 3am — compute consumption snapshots */
  @Cron('0 3 * * 0')
  async computeWeeklySnapshots(): Promise<void> {
    this.logger.log('Weekly consumption snapshot computation started');

    const lastMonday = new Date();
    lastMonday.setDate(lastMonday.getDate() - lastMonday.getDay() - 6);
    lastMonday.setHours(0, 0, 0, 0);

    const nextSunday = new Date(lastMonday);
    nextSunday.setDate(nextSunday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    const rows: Array<{
      tenantId: string;
      productId: string;
      totalQty: string;
      orderCount: string;
    }> = await this.dataSource.query(
      `
      SELECT
        o."pharmacyTenantId" AS "tenantId",
        oi."productId",
        SUM(oi.quantity)   AS "totalQty",
        COUNT(DISTINCT o.id) AS "orderCount"
      FROM orders o
      JOIN order_items oi ON oi."orderId" = o.id
      WHERE o.status = 'delivered'
        AND o."updatedAt" BETWEEN $1 AND $2
      GROUP BY o."pharmacyTenantId", oi."productId"
      `,
      [lastMonday, nextSunday],
    );

    for (const row of rows) {
      const qty = parseInt(row.totalQty, 10);
      const orders = parseInt(row.orderCount, 10);
      await this.snapshotRepo.save(
        this.snapshotRepo.create({
          tenantId: row.tenantId,
          productId: row.productId,
          weekStart: lastMonday,
          quantityConsumed: qty,
          ordersPlaced: orders,
          avgOrderSize: orders ? qty / orders : 0,
          velocityLabel: this.classifyVelocity(qty),
        }),
      );
    }

    this.logger.log(`Consumption snapshots computed — ${rows.length} product-tenant pairs`);
  }

  /** Get the last N weeks of snapshots for a product in a pharmacy */
  async getSnapshots(
    tenantId: string,
    productId: string,
    weeks = 8,
  ): Promise<ConsumptionSnapshot[]> {
    return this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.productId = :productId', { productId })
      .orderBy('s.weekStart', 'DESC')
      .take(weeks)
      .getMany();
  }

  /** Get the regional demand multiplier for a product in a given region and month */
  async getRegionalMultiplier(
    productId: string,
    region: string,
    month: number,
  ): Promise<number> {
    const signal = await this.signalRepo.findOne({ where: { productId, region, month } });
    return signal ? Number(signal.demandMultiplier) : 1.0;
  }

  /** Detect a consumption spike: current week vs 4-week average */
  isSpiking(snapshots: ConsumptionSnapshot[]): boolean {
    if (snapshots.length < 2) return false;
    const current = snapshots[0].quantityConsumed;
    const avg4w = snapshots.slice(1, 5).reduce((s, r) => s + r.quantityConsumed, 0) / Math.min(4, snapshots.length - 1);
    return avg4w > 0 && current > avg4w * 1.5; // 50% above average = spike
  }

  private classifyVelocity(weeklyQty: number): string {
    if (weeklyQty === 0) return 'dead_stock';
    if (weeklyQty >= 50) return 'fast_mover';
    if (weeklyQty <= 5) return 'slow_mover';
    return 'normal';
  }
}

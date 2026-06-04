import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { WeeklyAnalyticsSnapshot } from './entities/weekly-analytics-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { TenantType } from '../common/enums/tenant-type.enum';

@Injectable()
export class AnalyticsSnapshotService {
  private readonly logger = new Logger(AnalyticsSnapshotService.name);

  constructor(
    @InjectRepository(WeeklyAnalyticsSnapshot)
    private readonly snapshotRepo: Repository<WeeklyAnalyticsSnapshot>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly dataSource: DataSource,
  ) {}

  /** Every Sunday at 4am — compute weekly snapshots for all pharmacy tenants */
  @Cron('0 4 * * 0')
  async computeWeeklySnapshots(): Promise<void> {
    this.logger.log('Weekly analytics snapshot computation started');

    const lastMonday = new Date();
    lastMonday.setDate(lastMonday.getDate() - lastMonday.getDay() - 6);
    lastMonday.setHours(0, 0, 0, 0);

    const nextSunday = new Date(lastMonday);
    nextSunday.setDate(nextSunday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    const pharmacies = await this.tenantRepo.find({
      where: { type: TenantType.PHARMACY, isActive: true },
    });

    let computed = 0;
    for (const pharmacy of pharmacies) {
      try {
        await this.computeForTenant(pharmacy.id, lastMonday, nextSunday);
        computed++;
      } catch (err: any) {
        this.logger.error(`Snapshot failed for tenant ${pharmacy.id}: ${err.message}`);
      }
    }

    this.logger.log(`Weekly analytics complete — ${computed}/${pharmacies.length} tenants`);
  }

  private async computeForTenant(
    tenantId: string,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<void> {
    // Fetch order stats for the week
    const [orderStats] = await this.dataSource.query(
      `
      SELECT
        COUNT(DISTINCT o.id)   AS "totalOrders",
        COALESCE(SUM(o."totalAmount"), 0) AS "totalSpend",
        (
          SELECT oi."productId"
          FROM order_items oi
          JOIN orders o2 ON o2.id = oi."orderId"
          WHERE o2."pharmacyTenantId" = $1
            AND o2.status = 'delivered'
            AND o2."updatedAt" BETWEEN $2 AND $3
          GROUP BY oi."productId"
          ORDER BY SUM(oi.quantity) DESC
          LIMIT 1
        ) AS "topProductId"
      FROM orders o
      WHERE o."pharmacyTenantId" = $1
        AND o.status = 'delivered'
        AND o."updatedAt" BETWEEN $2 AND $3
      `,
      [tenantId, weekStart, weekEnd],
    );

    // Fetch recommendation stats
    const [recStats] = await this.dataSource.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" BETWEEN $2 AND $3) AS "generated",
        COUNT(*) FILTER (WHERE outcome = 'acted_on' AND "outcomeAt" BETWEEN $2 AND $3) AS "acted_on"
      FROM ai_recommendations
      WHERE "pharmacyTenantId" = $1
        AND "riskLevel" = 'HIGH'
        AND type = 'reorder'
      `,
      [tenantId, weekStart, weekEnd],
    );

    const generated  = parseInt(recStats?.generated  ?? '0', 10);
    const actedOn    = parseInt(recStats?.acted_on   ?? '0', 10);
    const totalOrders = parseInt(orderStats?.totalOrders ?? '0', 10);
    const totalSpend  = parseFloat(orderStats?.totalSpend ?? '0');
    const conversionRate = generated > 0 ? actedOn / generated : 0;

    // Upsert snapshot
    const existing = await this.snapshotRepo.findOne({ where: { tenantId, weekStart } });
    const payload = {
      tenantId,
      weekStart,
      totalOrders,
      totalSpend,
      currency: 'SAR',
      recommendationsGenerated:  generated,
      recommendationsActedOn:    actedOn,
      recommendationConversionRate: conversionRate,
      stockoutEvents: 0,  // TODO: count from inventory movement events in Phase 1.5 Month 4+
      topProductId: orderStats?.topProductId ?? null,
      computedAt: new Date(),
    };

    if (existing) {
      await this.snapshotRepo.update(existing.id, payload);
    } else {
      await this.snapshotRepo.save(this.snapshotRepo.create(payload));
    }
  }

  /** Read snapshots for a given tenant (for dashboard API) */
  async getSnapshots(tenantId: string, weeks = 12): Promise<WeeklyAnalyticsSnapshot[]> {
    return this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId })
      .orderBy('s.weekStart', 'DESC')
      .take(weeks)
      .getMany();
  }
}

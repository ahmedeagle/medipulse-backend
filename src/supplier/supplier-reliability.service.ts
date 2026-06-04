import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupplierReliabilityScore } from './entities/supplier-reliability-score.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { TenantType } from '../common/enums/tenant-type.enum';
import { OrderStatus } from '../common/enums/order-status.enum';

@Injectable()
export class SupplierReliabilityService {
  private readonly logger = new Logger(SupplierReliabilityService.name);

  constructor(
    @InjectRepository(SupplierReliabilityScore)
    private readonly scoreRepo: Repository<SupplierReliabilityScore>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly dataSource: DataSource,
  ) {}

  /** Daily cron: recalculate reliability scores for all suppliers */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async recalculateAll(): Promise<void> {
    this.logger.log('Supplier reliability scoring started');

    const suppliers = await this.tenantRepo.find({
      where: { type: TenantType.SUPPLIER, isActive: true },
    });

    for (const supplier of suppliers) {
      try {
        await this.calculateScore(supplier.id);
      } catch (err: any) {
        this.logger.error(`Scoring failed for supplier ${supplier.id}: ${err.message}`);
      }
    }

    this.logger.log(`Supplier reliability scoring complete — ${suppliers.length} suppliers scored`);
  }

  async calculateScore(supplierTenantId: string): Promise<SupplierReliabilityScore> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);

    const rows: Array<{
      status: string;
      acceptedAt: Date | null;
      deliveredAt: Date | null;
    }> = await this.dataSource.query(
      `
      SELECT
        o.status,
        MIN(CASE WHEN o.status IN ('accepted','shipped','delivered') THEN o."updatedAt" END) AS "acceptedAt",
        MAX(CASE WHEN o.status = 'delivered' THEN o."updatedAt" END) AS "deliveredAt"
      FROM orders o
      WHERE o."supplierTenantId" = $1
        AND o."createdAt" >= $2
      GROUP BY o.id, o.status
      `,
      [supplierTenantId, ninetyDaysAgo],
    );

    const total = rows.length;
    if (total === 0) {
      return this.upsertScore(supplierTenantId, null, {
        acceptanceRate: 0,
        avgDeliveryDays: 0,
        fulfillmentRate: 0,
        sampleSize: 0,
      });
    }

    const accepted   = rows.filter((r) => r.status !== OrderStatus.CANCELLED).length;
    const delivered  = rows.filter((r) => r.status === OrderStatus.DELIVERED).length;

    const deliveryTimes = rows
      .filter((r) => r.acceptedAt && r.deliveredAt)
      .map((r) => (new Date(r.deliveredAt).getTime() - new Date(r.acceptedAt).getTime()) / 86_400_000);

    const avgDeliveryDays = deliveryTimes.length
      ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length
      : 0;

    return this.upsertScore(supplierTenantId, null, {
      acceptanceRate: accepted / total,
      avgDeliveryDays,
      fulfillmentRate: delivered / total,
      sampleSize: total,
    });
  }

  async getScore(supplierTenantId: string): Promise<SupplierReliabilityScore | null> {
    return this.scoreRepo.findOne({ where: { supplierTenantId, productId: null } });
  }

  async getScores(supplierTenantIds: string[]): Promise<Map<string, SupplierReliabilityScore>> {
    if (!supplierTenantIds.length) return new Map();
    const scores = await this.scoreRepo
      .createQueryBuilder('s')
      .where('s.supplierTenantId IN (:...ids)', { ids: supplierTenantIds })
      .andWhere('s.productId IS NULL')
      .getMany();
    return new Map(scores.map((s) => [s.supplierTenantId, s]));
  }

  private async upsertScore(
    supplierTenantId: string,
    productId: string | null,
    data: { acceptanceRate: number; avgDeliveryDays: number; fulfillmentRate: number; sampleSize: number },
  ): Promise<SupplierReliabilityScore> {
    // Composite score: acceptance 40% + fulfillment 40% + delivery speed 20%
    // Delivery speed: normalise avgDeliveryDays (0 days = 100, 14+ days = 0)
    const deliverySpeedScore = Math.max(0, 1 - data.avgDeliveryDays / 14);
    const overallScore = Math.round(
      (data.acceptanceRate * 40 + data.fulfillmentRate * 40 + deliverySpeedScore * 20),
    );
    const reliabilityLabel = overallScore >= 70 ? 'high' : overallScore >= 40 ? 'medium' : 'low';

    const existing = await this.scoreRepo.findOne({
      where: { supplierTenantId, productId: productId ?? null },
    });

    const payload = {
      ...data,
      overallScore,
      reliabilityLabel,
      lastCalculatedAt: new Date(),
    };

    if (existing) {
      await this.scoreRepo.update(existing.id, payload);
      return this.scoreRepo.findOne({ where: { id: existing.id } });
    }

    return this.scoreRepo.save(
      this.scoreRepo.create({ supplierTenantId, productId, ...payload }),
    );
  }
}

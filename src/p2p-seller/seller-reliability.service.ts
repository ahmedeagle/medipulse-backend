import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SellerReliabilityScore, TrustLevel } from './entities/seller-reliability-score.entity';

@Injectable()
export class SellerReliabilityService {
  private readonly logger = new Logger(SellerReliabilityService.name);

  constructor(
    @InjectRepository(SellerReliabilityScore)
    private readonly scoreRepo: Repository<SellerReliabilityScore>,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async recalculateAll(): Promise<void> {
    this.logger.log('P2P seller reliability scoring started');

    const sellers: Array<{ sellerTenantId: string }> = await this.dataSource.query(`
      SELECT DISTINCT "sellerTenantId" FROM p2p_orders
      WHERE "createdAt" >= NOW() - INTERVAL '90 days'
    `);

    for (const { sellerTenantId } of sellers) {
      try {
        await this.calculateScore(sellerTenantId);
      } catch (err: any) {
        this.logger.error(`P2P scoring failed for seller ${sellerTenantId}: ${err.message}`);
      }
    }

    this.logger.log(`P2P reliability scoring complete — ${sellers.length} sellers scored`);
  }

  async calculateScore(sellerTenantId: string): Promise<SellerReliabilityScore> {
    const rows: Array<{
      status: string;
      created_at: Date;
      responded_at: Date | null;
    }> = await this.dataSource.query(
      `
      SELECT status, "createdAt" AS created_at, "respondedAt" AS responded_at
      FROM p2p_orders
      WHERE "sellerTenantId" = $1
        AND "createdAt" >= NOW() - INTERVAL '90 days'
      `,
      [sellerTenantId],
    );

    const total = rows.length;
    if (total === 0) {
      return this.upsertScore(sellerTenantId, {
        acceptanceRate: 0,
        avgResponseMinutes: 0,
        fulfillmentRate: 0,
        sampleSize: 0,
      });
    }

    const accepted = rows.filter((r) => r.status === 'accepted' || r.status === 'completed').length;
    const completed = rows.filter((r) => r.status === 'completed').length;

    const responseTimes = rows
      .filter((r) => r.responded_at)
      .map(
        (r) =>
          (new Date(r.responded_at).getTime() - new Date(r.created_at).getTime()) / 60_000,
      );

    const avgResponseMinutes = responseTimes.length
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 1440;

    return this.upsertScore(sellerTenantId, {
      acceptanceRate: accepted / total,
      avgResponseMinutes,
      fulfillmentRate: completed / total,
      sampleSize: total,
    });
  }

  async getScore(pharmacyTenantId: string): Promise<SellerReliabilityScore | null> {
    return this.scoreRepo.findOne({ where: { pharmacyTenantId } });
  }

  async getScores(
    pharmacyTenantIds: string[],
  ): Promise<Map<string, SellerReliabilityScore>> {
    if (!pharmacyTenantIds.length) return new Map();
    const scores = await this.scoreRepo
      .createQueryBuilder('s')
      .where('s.pharmacyTenantId IN (:...ids)', { ids: pharmacyTenantIds })
      .getMany();
    return new Map(scores.map((s) => [s.pharmacyTenantId, s]));
  }

  private async upsertScore(
    pharmacyTenantId: string,
    data: {
      acceptanceRate: number;
      avgResponseMinutes: number;
      fulfillmentRate: number;
      sampleSize: number;
    },
  ): Promise<SellerReliabilityScore> {
    const responseSpeed = Math.max(0, 1 - data.avgResponseMinutes / 1440);
    const overallScore = Math.round(
      data.acceptanceRate * 50 + responseSpeed * 30 + data.fulfillmentRate * 20,
    );
    const label = overallScore >= 70 ? 'high' : overallScore >= 40 ? 'medium' : 'low';
    const trustLevel = this.deriveTrustLevel(overallScore, data.sampleSize);

    const payload = {
      ...data,
      overallScore,
      label,
      trustLevel,
      lastCalculatedAt: new Date(),
    };

    const existing = await this.scoreRepo.findOne({ where: { pharmacyTenantId } });
    if (existing) {
      await this.scoreRepo.update(existing.id, payload);
      return this.scoreRepo.findOne({ where: { id: existing.id } });
    }

    return this.scoreRepo.save(this.scoreRepo.create({ pharmacyTenantId, ...payload }));
  }

  private deriveTrustLevel(overallScore: number, sampleSize: number): TrustLevel {
    if (overallScore >= 90 && sampleSize >= 50) return 'platinum';
    if (overallScore >= 75 && sampleSize >= 20) return 'gold';
    if (overallScore >= 55 && sampleSize >= 5) return 'silver';
    return 'bronze';
  }
}

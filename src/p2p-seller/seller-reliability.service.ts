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
        avgRating: null,
        reviewSample: 0,
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

    // Buyer ratings — included only when sample is meaningful (≥3 reviews).
    // Avoids the "one angry buyer tanks a new seller" failure mode common
    // in early-stage GCC/Egypt marketplaces.
    const ratingRows: Array<{ avg_rating: string | null; sample: string }> =
      await this.dataSource.query(
        `SELECT AVG(rating)::numeric(5,2) AS avg_rating,
                COUNT(*)::int            AS sample
           FROM p2p_reviews
          WHERE "sellerTenantId" = $1
            AND "createdAt" >= NOW() - INTERVAL '180 days'`,
        [sellerTenantId],
      );
    const reviewSample = Number(ratingRows[0]?.sample ?? 0);
    const avgRating =
      reviewSample >= 3 && ratingRows[0]?.avg_rating !== null
        ? Number(ratingRows[0].avg_rating)
        : null;

    return this.upsertScore(sellerTenantId, {
      acceptanceRate: accepted / total,
      avgResponseMinutes,
      fulfillmentRate: completed / total,
      sampleSize: total,
      avgRating,
      reviewSample,
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
      avgRating?: number | null;
      reviewSample?: number;
    },
  ): Promise<SellerReliabilityScore> {
    const responseSpeed = Math.max(0, 1 - data.avgResponseMinutes / 1440);
    const opsScore =
      data.acceptanceRate * 50 + responseSpeed * 30 + data.fulfillmentRate * 20;

    // Blend buyer ratings (1–5 → 0–100 scale) into the score when we have
    // a meaningful sample. Weight grows with sample size, capped at 30%.
    let overallScore = opsScore;
    if (data.avgRating !== null && data.avgRating !== undefined && data.reviewSample && data.reviewSample >= 3) {
      const reviewScore = ((data.avgRating - 1) / 4) * 100; // 1→0, 5→100
      const weight = Math.min(0.3, data.reviewSample / 100); // 3 → 0.03, 100 → 0.3
      overallScore = opsScore * (1 - weight) + reviewScore * weight;
    }
    overallScore = Math.round(overallScore);

    const label = overallScore >= 70 ? 'high' : overallScore >= 40 ? 'medium' : 'low';
    const trustLevel = this.deriveTrustLevel(overallScore, data.sampleSize);

    const payload = {
      acceptanceRate: data.acceptanceRate,
      avgResponseMinutes: data.avgResponseMinutes,
      fulfillmentRate: data.fulfillmentRate,
      sampleSize: data.sampleSize,
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

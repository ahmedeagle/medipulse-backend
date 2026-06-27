import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { P2pReview } from './entities/p2p-review.entity';
import { P2pOrder } from '../p2p-orders/entities/p2p-order.entity';
import { CreateP2pReviewDto } from './dto/create-p2p-review.dto';

export interface SellerReviewAggregate {
  sellerTenantId: string;
  avgRating: number;
  sampleSize: number;
  ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

@Injectable()
export class P2pReviewsService {
  private readonly logger = new Logger(P2pReviewsService.name);

  constructor(
    @InjectRepository(P2pReview)
    private readonly reviewRepo: Repository<P2pReview>,
    @InjectRepository(P2pOrder)
    private readonly orderRepo: Repository<P2pOrder>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Buyer leaves a rating after a completed order. Idempotent — re-posting on
   * the same order returns a 409, not silently overwriting (audit-friendly).
   */
  async create(
    buyerTenantId: string,
    orderId: string,
    dto: CreateP2pReviewDto,
  ): Promise<P2pReview> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerTenantId !== buyerTenantId)
      throw new ForbiddenException('Only the buyer can review this order');
    if (order.status !== 'completed')
      throw new BadRequestException('Reviews can only be left after the order is completed');

    const existing = await this.reviewRepo.findOne({ where: { orderId } });
    if (existing) throw new ConflictException('This order has already been reviewed');

    const review = await this.reviewRepo.save(
      this.reviewRepo.create({
        orderId,
        buyerTenantId,
        sellerTenantId: order.sellerTenantId,
        rating: dto.rating,
        comment: dto.comment ?? null,
      }),
    );

    // Best-effort event — listeners (reliability cron, notifications) handle this async
    this.eventEmitter.emit('p2p.review.created', {
      reviewId: review.id,
      orderId,
      sellerTenantId: order.sellerTenantId,
      buyerTenantId,
      rating: dto.rating,
    });

    return review;
  }

  /** List of reviews for a seller (paginated, newest first). */
  async listForSeller(
    sellerTenantId: string,
    opts: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: P2pReview[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 20));

    const [items, total] = await this.reviewRepo.findAndCount({
      where: { sellerTenantId },
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });

    return { items, total, page, pageSize };
  }

  /**
   * Aggregate score for a seller — used by reliability cron and marketplace
   * "trust at a glance" badges. Single SQL pass, indexed by
   * (sellerTenantId, rating).
   */
  async getSellerAggregate(sellerTenantId: string): Promise<SellerReviewAggregate> {
    const rows: Array<{ rating: number; count: string }> = await this.reviewRepo
      .createQueryBuilder('r')
      .select('r.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('r."sellerTenantId" = :sellerTenantId', { sellerTenantId })
      .groupBy('r.rating')
      .getRawMany();

    const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let total = 0;
    for (const r of rows) {
      const rating = Math.trunc(Number(r.rating)) as 1 | 2 | 3 | 4 | 5;
      const count = Number(r.count);
      if (rating >= 1 && rating <= 5) {
        dist[rating] = count;
        sum += rating * count;
        total += count;
      }
    }

    return {
      sellerTenantId,
      avgRating: total > 0 ? Math.round((sum / total) * 100) / 100 : 0,
      sampleSize: total,
      ratingDistribution: dist,
    };
  }

  /** Batch aggregate — used by marketplace search to enrich many seller cards. */
  async getSellerAggregates(
    sellerTenantIds: string[],
  ): Promise<Map<string, SellerReviewAggregate>> {
    const out = new Map<string, SellerReviewAggregate>();
    if (!sellerTenantIds.length) return out;

    const rows: Array<{ sellerTenantId: string; rating: number; count: string }> =
      await this.reviewRepo
        .createQueryBuilder('r')
        .select('r.sellerTenantId', 'sellerTenantId')
        .addSelect('r.rating', 'rating')
        .addSelect('COUNT(*)', 'count')
        .where('r."sellerTenantId" IN (:...ids)', { ids: sellerTenantIds })
        .groupBy('r.sellerTenantId')
        .addGroupBy('r.rating')
        .getRawMany();

    for (const id of sellerTenantIds) {
      out.set(id, {
        sellerTenantId: id,
        avgRating: 0,
        sampleSize: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      });
    }

    const sums = new Map<string, { sum: number; total: number }>();
    for (const r of rows) {
      const id = r.sellerTenantId;
      const rating = Math.trunc(Number(r.rating)) as 1 | 2 | 3 | 4 | 5;
      const count = Number(r.count);
      const agg = out.get(id);
      if (!agg || rating < 1 || rating > 5) continue;
      agg.ratingDistribution[rating] = count;
      const s = sums.get(id) ?? { sum: 0, total: 0 };
      s.sum += rating * count;
      s.total += count;
      sums.set(id, s);
    }
    for (const [id, s] of sums.entries()) {
      const agg = out.get(id)!;
      agg.sampleSize = s.total;
      agg.avgRating = s.total > 0 ? Math.round((s.sum / s.total) * 100) / 100 : 0;
    }
    return out;
  }
}

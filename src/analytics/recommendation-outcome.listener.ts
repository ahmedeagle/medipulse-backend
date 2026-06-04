import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { OrderDeliveredEvent, EVENTS } from '../events/domain-events';
import { RecommendationType } from '../common/enums/recommendation-type.enum';

/**
 * Closes the AI feedback loop by tracking what happens after a recommendation.
 *
 * acted_on: pharmacy places an order that delivers a product with a HIGH-risk REORDER rec
 * ignored:  no action for 7+ days (marked by daily cron)
 *
 * This data directly measures recommendation quality and feeds future
 * improvements to the rules engine and confidence scoring.
 */
@Injectable()
export class RecommendationOutcomeListener {
  private readonly logger = new Logger(RecommendationOutcomeListener.name);

  constructor(
    @InjectRepository(AiRecommendation)
    private readonly recRepo: Repository<AiRecommendation>,
  ) {}

  @OnEvent(EVENTS.ORDER_DELIVERED)
  async onOrderDelivered(event: OrderDeliveredEvent): Promise<void> {
    try {
      const productIds = event.items.map((i) => i.productId);
      if (!productIds.length) return;

      // Find active HIGH-risk REORDER recommendations for the delivered products
      const recs = await this.recRepo
        .createQueryBuilder('r')
        .where('r.pharmacyTenantId = :tenantId', { tenantId: event.pharmacyTenantId })
        .andWhere('r.productId IN (:...productIds)', { productIds })
        .andWhere('r.type = :type', { type: RecommendationType.REORDER })
        .andWhere('r.riskLevel = :risk', { risk: 'HIGH' })
        .andWhere('r.outcome IS NULL')
        .andWhere('r.isDismissed = false')
        .getMany();

      if (!recs.length) return;

      await this.recRepo
        .createQueryBuilder()
        .update()
        .set({ outcome: 'acted_on', outcomeAt: new Date() })
        .where('id IN (:...ids)', { ids: recs.map((r) => r.id) })
        .execute();

      this.logger.log(
        `Marked ${recs.length} recommendation(s) as acted_on for tenant ${event.pharmacyTenantId}`,
      );
    } catch (err: any) {
      this.logger.error(`RecommendationOutcome update failed: ${err.message}`);
    }
  }

  /** Daily cron: mark HIGH-risk recommendations older than 7 days with no outcome as ignored */
  @Cron('0 5 * * *')
  async markIgnored(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

    const result = await this.recRepo
      .createQueryBuilder()
      .update()
      .set({ outcome: 'ignored', outcomeAt: new Date() })
      .where('outcome IS NULL')
      .andWhere('riskLevel = :risk', { risk: 'HIGH' })
      .andWhere('"createdAt" <= :cutoff', { cutoff: sevenDaysAgo })
      .andWhere('"isDismissed" = false')
      .execute();

    if (result.affected) {
      this.logger.log(`Marked ${result.affected} recommendation(s) as ignored`);
    }
  }
}

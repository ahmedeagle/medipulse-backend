import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProcurementDraftService } from './procurement-draft.service';
import { RecommendationGeneratedEvent, EVENTS } from '../events/domain-events';

/**
 * Listens for HIGH-risk RecommendationGeneratedEvent and automatically creates
 * a ProcurementDraft so the pharmacy admin has a one-click approval waiting.
 *
 * Fire-and-forget: errors are caught and logged; they never bubble back to the emitter.
 */
@Injectable()
export class ProcurementDraftListener {
  private readonly logger = new Logger(ProcurementDraftListener.name);

  constructor(private readonly draftService: ProcurementDraftService) {}

  @OnEvent(EVENTS.RECOMMENDATION_GENERATED)
  async onRecommendationGenerated(event: RecommendationGeneratedEvent): Promise<void> {
    if (event.riskLevel !== 'HIGH') return;

    try {
      const draft = await this.draftService.generateFromRecommendation(
        event.recommendationId,
        event.tenantId,
      );
      if (draft) {
        this.logger.log(`Auto-draft created for pharmacy ${event.tenantId} → draft ${draft.id}`);
      }
    } catch (err: any) {
      this.logger.error(`Auto-draft failed for rec ${event.recommendationId}: ${err.message}`);
    }
  }
}

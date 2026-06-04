import { ProcurementDraftService } from './procurement-draft.service';
import { RecommendationGeneratedEvent } from '../events/domain-events';
export declare class ProcurementDraftListener {
    private readonly draftService;
    private readonly logger;
    constructor(draftService: ProcurementDraftService);
    onRecommendationGenerated(event: RecommendationGeneratedEvent): Promise<void>;
}

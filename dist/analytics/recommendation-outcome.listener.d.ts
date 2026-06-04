import { Repository } from 'typeorm';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { OrderDeliveredEvent } from '../events/domain-events';
export declare class RecommendationOutcomeListener {
    private readonly recRepo;
    private readonly logger;
    constructor(recRepo: Repository<AiRecommendation>);
    onOrderDelivered(event: OrderDeliveredEvent): Promise<void>;
    markIgnored(): Promise<void>;
}

import { WebhookService } from './webhook.service';
import { InventoryUpdatedEvent, RecommendationGeneratedEvent, OrderStatusChangedEvent, OrderDeliveredEvent, SupplierStockChangedEvent, StockRiskDetectedEvent, AiGovernanceBlockedEvent, RecommendationDismissedEvent } from '../events/domain-events';
export declare class WebhookDispatchListener {
    private readonly webhookService;
    constructor(webhookService: WebhookService);
    onInventoryUpdated(event: InventoryUpdatedEvent): void;
    onRecommendationGenerated(event: RecommendationGeneratedEvent): void;
    onOrderStatusChanged(event: OrderStatusChangedEvent): void;
    onOrderDelivered(event: OrderDeliveredEvent): void;
    onSupplierStockChanged(event: SupplierStockChangedEvent): void;
    onStockRiskDetected(event: StockRiskDetectedEvent): void;
    onAiGovernanceBlocked(event: AiGovernanceBlockedEvent): void;
    onRecommendationDismissed(event: RecommendationDismissedEvent): void;
}

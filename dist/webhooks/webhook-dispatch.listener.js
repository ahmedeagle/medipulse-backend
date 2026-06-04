"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookDispatchListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const webhook_service_1 = require("./webhook.service");
const domain_events_1 = require("../events/domain-events");
let WebhookDispatchListener = class WebhookDispatchListener {
    constructor(webhookService) {
        this.webhookService = webhookService;
    }
    onInventoryUpdated(event) {
        this.webhookService.dispatchEvent(domain_events_1.EVENTS.INVENTORY_UPDATED, {
            tenantId: event.tenantId,
            productId: event.productId,
            quantity: event.quantity,
            previousQuantity: event.previousQuantity,
            trigger: event.trigger,
        }).catch(() => { });
    }
    onRecommendationGenerated(event) {
        this.webhookService.dispatchEvent(domain_events_1.EVENTS.RECOMMENDATION_GENERATED, {
            tenantId: event.tenantId,
            recommendationId: event.recommendationId,
            type: event.type,
            riskLevel: event.riskLevel,
            confidence: event.confidence,
        }).catch(() => { });
    }
    onOrderStatusChanged(event) {
        this.webhookService.dispatchEvent(domain_events_1.EVENTS.ORDER_STATUS_CHANGED, {
            orderId: event.orderId,
            pharmacyTenantId: event.pharmacyTenantId,
            supplierTenantId: event.supplierTenantId,
            from: event.from,
            to: event.to,
        }).catch(() => { });
    }
    onOrderDelivered(event) {
        this.webhookService.dispatchEvent(domain_events_1.EVENTS.ORDER_DELIVERED, {
            orderId: event.orderId,
            pharmacyTenantId: event.pharmacyTenantId,
            supplierTenantId: event.supplierTenantId,
            itemCount: event.items.length,
        }).catch(() => { });
    }
    onSupplierStockChanged(event) {
        this.webhookService.dispatchEvent(domain_events_1.EVENTS.SUPPLIER_STOCK_CHANGED, {
            catalogItemId: event.catalogItemId,
            supplierTenantId: event.supplierTenantId,
            productId: event.productId,
            stock: event.stock,
            price: event.price,
        }).catch(() => { });
    }
    onStockRiskDetected(event) {
        this.webhookService.dispatchEvent(domain_events_1.EVENTS.STOCK_RISK_DETECTED, {
            tenantId: event.tenantId,
            productId: event.productId,
            riskLevel: event.riskLevel,
            stockDays: event.stockDays,
            suggestedQty: event.suggestedQty,
        }).catch(() => { });
    }
    onAiGovernanceBlocked(event) {
        this.webhookService.dispatchEvent(domain_events_1.EVENTS.AI_GOVERNANCE_BLOCKED, {
            tenantId: event.tenantId,
            blockType: event.blockType,
            reason: event.reason,
            promptVersion: event.promptVersion,
        }).catch(() => { });
    }
    onRecommendationDismissed(event) {
        this.webhookService.dispatchEvent(domain_events_1.EVENTS.RECOMMENDATION_DISMISSED, {
            tenantId: event.tenantId,
            recommendationId: event.recommendationId,
            feedbackScore: event.feedbackScore,
        }).catch(() => { });
    }
};
exports.WebhookDispatchListener = WebhookDispatchListener;
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.INVENTORY_UPDATED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.InventoryUpdatedEvent]),
    __metadata("design:returntype", void 0)
], WebhookDispatchListener.prototype, "onInventoryUpdated", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.RECOMMENDATION_GENERATED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.RecommendationGeneratedEvent]),
    __metadata("design:returntype", void 0)
], WebhookDispatchListener.prototype, "onRecommendationGenerated", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_STATUS_CHANGED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.OrderStatusChangedEvent]),
    __metadata("design:returntype", void 0)
], WebhookDispatchListener.prototype, "onOrderStatusChanged", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_DELIVERED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.OrderDeliveredEvent]),
    __metadata("design:returntype", void 0)
], WebhookDispatchListener.prototype, "onOrderDelivered", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.SUPPLIER_STOCK_CHANGED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.SupplierStockChangedEvent]),
    __metadata("design:returntype", void 0)
], WebhookDispatchListener.prototype, "onSupplierStockChanged", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.STOCK_RISK_DETECTED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.StockRiskDetectedEvent]),
    __metadata("design:returntype", void 0)
], WebhookDispatchListener.prototype, "onStockRiskDetected", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.AI_GOVERNANCE_BLOCKED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.AiGovernanceBlockedEvent]),
    __metadata("design:returntype", void 0)
], WebhookDispatchListener.prototype, "onAiGovernanceBlocked", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.RECOMMENDATION_DISMISSED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.RecommendationDismissedEvent]),
    __metadata("design:returntype", void 0)
], WebhookDispatchListener.prototype, "onRecommendationDismissed", null);
exports.WebhookDispatchListener = WebhookDispatchListener = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [webhook_service_1.WebhookService])
], WebhookDispatchListener);
//# sourceMappingURL=webhook-dispatch.listener.js.map
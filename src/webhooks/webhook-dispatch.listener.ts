import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhookService } from './webhook.service';
import {
  EVENTS,
  InventoryUpdatedEvent,
  RecommendationGeneratedEvent,
  OrderStatusChangedEvent,
  OrderDeliveredEvent,
  SupplierStockChangedEvent,
  StockRiskDetectedEvent,
  AiGovernanceBlockedEvent,
  RecommendationDismissedEvent,
} from '../events/domain-events';

/**
 * Listens to all domain events and fans them out to webhook subscribers.
 * Lives in the main HTTP app — enqueueing is fast (Redis write), never blocks HTTP response.
 */
@Injectable()
export class WebhookDispatchListener {
  constructor(private readonly webhookService: WebhookService) {}

  @OnEvent(EVENTS.INVENTORY_UPDATED)
  onInventoryUpdated(event: InventoryUpdatedEvent) {
    this.webhookService.dispatchEvent(EVENTS.INVENTORY_UPDATED, {
      tenantId: event.tenantId,
      productId: event.productId,
      quantity: event.quantity,
      previousQuantity: event.previousQuantity,
      trigger: event.trigger,
    }).catch(() => {});
  }

  @OnEvent(EVENTS.RECOMMENDATION_GENERATED)
  onRecommendationGenerated(event: RecommendationGeneratedEvent) {
    this.webhookService.dispatchEvent(EVENTS.RECOMMENDATION_GENERATED, {
      tenantId: event.tenantId,
      recommendationId: event.recommendationId,
      type: event.type,
      riskLevel: event.riskLevel,
      confidence: event.confidence,
    }).catch(() => {});
  }

  @OnEvent(EVENTS.ORDER_STATUS_CHANGED)
  onOrderStatusChanged(event: OrderStatusChangedEvent) {
    this.webhookService.dispatchEvent(EVENTS.ORDER_STATUS_CHANGED, {
      orderId: event.orderId,
      pharmacyTenantId: event.pharmacyTenantId,
      supplierTenantId: event.supplierTenantId,
      from: event.from,
      to: event.to,
    }).catch(() => {});
  }

  @OnEvent(EVENTS.ORDER_DELIVERED)
  onOrderDelivered(event: OrderDeliveredEvent) {
    this.webhookService.dispatchEvent(EVENTS.ORDER_DELIVERED, {
      orderId: event.orderId,
      pharmacyTenantId: event.pharmacyTenantId,
      supplierTenantId: event.supplierTenantId,
      itemCount: event.items.length,
    }).catch(() => {});
  }

  @OnEvent(EVENTS.SUPPLIER_STOCK_CHANGED)
  onSupplierStockChanged(event: SupplierStockChangedEvent) {
    this.webhookService.dispatchEvent(EVENTS.SUPPLIER_STOCK_CHANGED, {
      catalogItemId: event.catalogItemId,
      supplierTenantId: event.supplierTenantId,
      productId: event.productId,
      stock: event.stock,
      price: event.price,
    }).catch(() => {});
  }

  @OnEvent(EVENTS.STOCK_RISK_DETECTED)
  onStockRiskDetected(event: StockRiskDetectedEvent) {
    this.webhookService.dispatchEvent(EVENTS.STOCK_RISK_DETECTED, {
      tenantId: event.tenantId,
      productId: event.productId,
      riskLevel: event.riskLevel,
      stockDays: event.stockDays,
      suggestedQty: event.suggestedQty,
    }).catch(() => {});
  }

  @OnEvent(EVENTS.AI_GOVERNANCE_BLOCKED)
  onAiGovernanceBlocked(event: AiGovernanceBlockedEvent) {
    this.webhookService.dispatchEvent(EVENTS.AI_GOVERNANCE_BLOCKED, {
      tenantId: event.tenantId,
      blockType: event.blockType,
      reason: event.reason,
      promptVersion: event.promptVersion,
    }).catch(() => {});
  }

  @OnEvent(EVENTS.RECOMMENDATION_DISMISSED)
  onRecommendationDismissed(event: RecommendationDismissedEvent) {
    this.webhookService.dispatchEvent(EVENTS.RECOMMENDATION_DISMISSED, {
      tenantId: event.tenantId,
      recommendationId: event.recommendationId,
      feedbackScore: event.feedbackScore,
    }).catch(() => {});
  }
}

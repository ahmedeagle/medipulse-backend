"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENTS = exports.OrderOnHoldEvent = exports.OrderCreditIssuedEvent = exports.OrderReturnRequestedEvent = exports.OrderDisputedEvent = exports.OrderBackOrderedEvent = exports.OrderApprovalRequiredEvent = exports.OrderSubmittedEvent = exports.RecommendationDismissedEvent = exports.AiGovernanceBlockedEvent = exports.StockRiskDetectedEvent = exports.SupplierStockChangedEvent = exports.OrderDeliveredEvent = exports.OrderStatusChangedEvent = exports.RecommendationGeneratedEvent = exports.InventoryUpdatedEvent = void 0;
class InventoryUpdatedEvent {
    constructor(tenantId, productId, quantity, previousQuantity, trigger, correlationId) {
        this.tenantId = tenantId;
        this.productId = productId;
        this.quantity = quantity;
        this.previousQuantity = previousQuantity;
        this.trigger = trigger;
        this.correlationId = correlationId;
    }
}
exports.InventoryUpdatedEvent = InventoryUpdatedEvent;
class RecommendationGeneratedEvent {
    constructor(tenantId, recommendationId, type, riskLevel, confidence, correlationId) {
        this.tenantId = tenantId;
        this.recommendationId = recommendationId;
        this.type = type;
        this.riskLevel = riskLevel;
        this.confidence = confidence;
        this.correlationId = correlationId;
    }
}
exports.RecommendationGeneratedEvent = RecommendationGeneratedEvent;
class OrderStatusChangedEvent {
    constructor(orderId, pharmacyTenantId, supplierTenantId, from, to, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.supplierTenantId = supplierTenantId;
        this.from = from;
        this.to = to;
        this.correlationId = correlationId;
    }
}
exports.OrderStatusChangedEvent = OrderStatusChangedEvent;
class OrderDeliveredEvent {
    constructor(orderId, pharmacyTenantId, supplierTenantId, items, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.supplierTenantId = supplierTenantId;
        this.items = items;
        this.correlationId = correlationId;
    }
}
exports.OrderDeliveredEvent = OrderDeliveredEvent;
class SupplierStockChangedEvent {
    constructor(catalogItemId, supplierTenantId, productId, stock, price, correlationId) {
        this.catalogItemId = catalogItemId;
        this.supplierTenantId = supplierTenantId;
        this.productId = productId;
        this.stock = stock;
        this.price = price;
        this.correlationId = correlationId;
    }
}
exports.SupplierStockChangedEvent = SupplierStockChangedEvent;
class StockRiskDetectedEvent {
    constructor(tenantId, productId, riskLevel, stockDays, suggestedQty, correlationId) {
        this.tenantId = tenantId;
        this.productId = productId;
        this.riskLevel = riskLevel;
        this.stockDays = stockDays;
        this.suggestedQty = suggestedQty;
        this.correlationId = correlationId;
    }
}
exports.StockRiskDetectedEvent = StockRiskDetectedEvent;
class AiGovernanceBlockedEvent {
    constructor(tenantId, blockType, reason, promptVersion, correlationId) {
        this.tenantId = tenantId;
        this.blockType = blockType;
        this.reason = reason;
        this.promptVersion = promptVersion;
        this.correlationId = correlationId;
    }
}
exports.AiGovernanceBlockedEvent = AiGovernanceBlockedEvent;
class RecommendationDismissedEvent {
    constructor(tenantId, recommendationId, feedbackScore, correlationId) {
        this.tenantId = tenantId;
        this.recommendationId = recommendationId;
        this.feedbackScore = feedbackScore;
        this.correlationId = correlationId;
    }
}
exports.RecommendationDismissedEvent = RecommendationDismissedEvent;
class OrderSubmittedEvent {
    constructor(orderId, pharmacyTenantId, supplierTenantId, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.supplierTenantId = supplierTenantId;
        this.correlationId = correlationId;
    }
}
exports.OrderSubmittedEvent = OrderSubmittedEvent;
class OrderApprovalRequiredEvent {
    constructor(orderId, pharmacyTenantId, totalAmount, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.totalAmount = totalAmount;
        this.correlationId = correlationId;
    }
}
exports.OrderApprovalRequiredEvent = OrderApprovalRequiredEvent;
class OrderBackOrderedEvent {
    constructor(orderId, pharmacyTenantId, supplierTenantId, reason, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.supplierTenantId = supplierTenantId;
        this.reason = reason;
        this.correlationId = correlationId;
    }
}
exports.OrderBackOrderedEvent = OrderBackOrderedEvent;
class OrderDisputedEvent {
    constructor(orderId, pharmacyTenantId, supplierTenantId, reason, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.supplierTenantId = supplierTenantId;
        this.reason = reason;
        this.correlationId = correlationId;
    }
}
exports.OrderDisputedEvent = OrderDisputedEvent;
class OrderReturnRequestedEvent {
    constructor(orderId, pharmacyTenantId, supplierTenantId, returnRequestId, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.supplierTenantId = supplierTenantId;
        this.returnRequestId = returnRequestId;
        this.correlationId = correlationId;
    }
}
exports.OrderReturnRequestedEvent = OrderReturnRequestedEvent;
class OrderCreditIssuedEvent {
    constructor(orderId, pharmacyTenantId, supplierTenantId, creditAmount, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.supplierTenantId = supplierTenantId;
        this.creditAmount = creditAmount;
        this.correlationId = correlationId;
    }
}
exports.OrderCreditIssuedEvent = OrderCreditIssuedEvent;
class OrderOnHoldEvent {
    constructor(orderId, pharmacyTenantId, supplierTenantId, reason, correlationId) {
        this.orderId = orderId;
        this.pharmacyTenantId = pharmacyTenantId;
        this.supplierTenantId = supplierTenantId;
        this.reason = reason;
        this.correlationId = correlationId;
    }
}
exports.OrderOnHoldEvent = OrderOnHoldEvent;
exports.EVENTS = {
    INVENTORY_UPDATED: 'inventory.updated',
    RECOMMENDATION_GENERATED: 'recommendation.generated',
    ORDER_STATUS_CHANGED: 'order.status_changed',
    ORDER_DELIVERED: 'order.delivered',
    ORDER_SUBMITTED: 'order.submitted',
    ORDER_APPROVAL_REQUIRED: 'order.approval_required',
    ORDER_BACK_ORDERED: 'order.back_ordered',
    ORDER_DISPUTED: 'order.disputed',
    ORDER_RETURN_REQUESTED: 'order.return_requested',
    ORDER_CREDIT_ISSUED: 'order.credit_issued',
    ORDER_ON_HOLD: 'order.on_hold',
    SUPPLIER_STOCK_CHANGED: 'supplier.stock_changed',
    STOCK_RISK_DETECTED: 'stock.risk_detected',
    AI_GOVERNANCE_BLOCKED: 'ai.governance_blocked',
    RECOMMENDATION_DISMISSED: 'recommendation.dismissed',
    PRODUCT_RECALLED: 'product.recalled',
    BATCH_EXPIRY_ALERT: 'batch.expiry_alert',
};
//# sourceMappingURL=domain-events.js.map
export declare class InventoryUpdatedEvent {
    readonly tenantId: string;
    readonly productId: string;
    readonly quantity: number;
    readonly previousQuantity: number;
    readonly trigger: 'manual' | 'order_delivery' | 'adjustment';
    readonly correlationId?: string;
    constructor(tenantId: string, productId: string, quantity: number, previousQuantity: number, trigger: 'manual' | 'order_delivery' | 'adjustment', correlationId?: string);
}
export declare class RecommendationGeneratedEvent {
    readonly tenantId: string;
    readonly recommendationId: string;
    readonly type: string;
    readonly riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    readonly confidence: number;
    readonly correlationId?: string;
    constructor(tenantId: string, recommendationId: string, type: string, riskLevel: 'HIGH' | 'MEDIUM' | 'LOW', confidence: number, correlationId?: string);
}
export declare class OrderStatusChangedEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly supplierTenantId: string;
    readonly from: string;
    readonly to: string;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, supplierTenantId: string, from: string, to: string, correlationId?: string);
}
export declare class OrderDeliveredEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly supplierTenantId: string;
    readonly items: Array<{
        productId: string;
        quantity: number;
        unitPrice: number;
    }>;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, supplierTenantId: string, items: Array<{
        productId: string;
        quantity: number;
        unitPrice: number;
    }>, correlationId?: string);
}
export declare class SupplierStockChangedEvent {
    readonly catalogItemId: string;
    readonly supplierTenantId: string;
    readonly productId: string;
    readonly stock: number;
    readonly price: number;
    readonly correlationId?: string;
    constructor(catalogItemId: string, supplierTenantId: string, productId: string, stock: number, price: number, correlationId?: string);
}
export declare class StockRiskDetectedEvent {
    readonly tenantId: string;
    readonly productId: string;
    readonly riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    readonly stockDays: number;
    readonly suggestedQty: number;
    readonly correlationId?: string;
    constructor(tenantId: string, productId: string, riskLevel: 'HIGH' | 'MEDIUM' | 'LOW', stockDays: number, suggestedQty: number, correlationId?: string);
}
export declare class AiGovernanceBlockedEvent {
    readonly tenantId: string;
    readonly blockType: 'input' | 'output';
    readonly reason: string;
    readonly promptVersion: string;
    readonly correlationId?: string;
    constructor(tenantId: string, blockType: 'input' | 'output', reason: string, promptVersion: string, correlationId?: string);
}
export declare class RecommendationDismissedEvent {
    readonly tenantId: string;
    readonly recommendationId: string;
    readonly feedbackScore: number | null;
    readonly correlationId?: string;
    constructor(tenantId: string, recommendationId: string, feedbackScore: number | null, correlationId?: string);
}
export declare class OrderSubmittedEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly supplierTenantId: string;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, supplierTenantId: string, correlationId?: string);
}
export declare class OrderApprovalRequiredEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly totalAmount: number;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, totalAmount: number, correlationId?: string);
}
export declare class OrderBackOrderedEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly supplierTenantId: string;
    readonly reason?: string;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, supplierTenantId: string, reason?: string, correlationId?: string);
}
export declare class OrderDisputedEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly supplierTenantId: string;
    readonly reason: string;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, supplierTenantId: string, reason: string, correlationId?: string);
}
export declare class OrderReturnRequestedEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly supplierTenantId: string;
    readonly returnRequestId: string;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, supplierTenantId: string, returnRequestId: string, correlationId?: string);
}
export declare class OrderCreditIssuedEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly supplierTenantId: string;
    readonly creditAmount: number;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, supplierTenantId: string, creditAmount: number, correlationId?: string);
}
export declare class OrderOnHoldEvent {
    readonly orderId: string;
    readonly pharmacyTenantId: string;
    readonly supplierTenantId: string;
    readonly reason: string;
    readonly correlationId?: string;
    constructor(orderId: string, pharmacyTenantId: string, supplierTenantId: string, reason: string, correlationId?: string);
}
export declare const EVENTS: {
    readonly INVENTORY_UPDATED: "inventory.updated";
    readonly RECOMMENDATION_GENERATED: "recommendation.generated";
    readonly ORDER_STATUS_CHANGED: "order.status_changed";
    readonly ORDER_DELIVERED: "order.delivered";
    readonly ORDER_SUBMITTED: "order.submitted";
    readonly ORDER_APPROVAL_REQUIRED: "order.approval_required";
    readonly ORDER_BACK_ORDERED: "order.back_ordered";
    readonly ORDER_DISPUTED: "order.disputed";
    readonly ORDER_RETURN_REQUESTED: "order.return_requested";
    readonly ORDER_CREDIT_ISSUED: "order.credit_issued";
    readonly ORDER_ON_HOLD: "order.on_hold";
    readonly SUPPLIER_STOCK_CHANGED: "supplier.stock_changed";
    readonly STOCK_RISK_DETECTED: "stock.risk_detected";
    readonly AI_GOVERNANCE_BLOCKED: "ai.governance_blocked";
    readonly RECOMMENDATION_DISMISSED: "recommendation.dismissed";
    readonly PRODUCT_RECALLED: "product.recalled";
    readonly BATCH_EXPIRY_ALERT: "batch.expiry_alert";
};

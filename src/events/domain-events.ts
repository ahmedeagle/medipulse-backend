/**
 * Typed domain event classes for MediPulse.
 *
 * All services emit these via NestJS EventEmitter2.
 * Listeners: WebhookDispatchListener, DomainEventStoreListener (Month 4), ProcurementDraftListener (Month 3).
 *
 * Naming convention: <Aggregate><Action>Event — past tense, because events describe facts that happened.
 */

export class InventoryUpdatedEvent {
  constructor(
    public readonly tenantId: string,
    public readonly productId: string,
    public readonly quantity: number,
    public readonly previousQuantity: number,
    public readonly trigger: 'manual' | 'order_delivery' | 'adjustment',
    public readonly correlationId?: string,
  ) {}
}

export class RecommendationGeneratedEvent {
  constructor(
    public readonly tenantId: string,
    public readonly recommendationId: string,
    public readonly type: string,
    public readonly riskLevel: 'HIGH' | 'MEDIUM' | 'LOW',
    public readonly confidence: number,
    public readonly correlationId?: string,
  ) {}
}

export class OrderStatusChangedEvent {
  constructor(
    public readonly orderId: string,
    public readonly pharmacyTenantId: string,
    public readonly supplierTenantId: string,
    public readonly from: string,
    public readonly to: string,
    public readonly correlationId?: string,
  ) {}
}

export class OrderDeliveredEvent {
  constructor(
    public readonly orderId: string,
    public readonly pharmacyTenantId: string,
    public readonly supplierTenantId: string,
    public readonly items: Array<{ productId: string; quantity: number; unitPrice: number }>,
    public readonly correlationId?: string,
  ) {}
}

export class SupplierStockChangedEvent {
  constructor(
    public readonly catalogItemId: string,
    public readonly supplierTenantId: string,
    public readonly productId: string,
    public readonly stock: number,
    public readonly price: number,
    public readonly correlationId?: string,
  ) {}
}

export class StockRiskDetectedEvent {
  constructor(
    public readonly tenantId: string,
    public readonly productId: string,
    public readonly riskLevel: 'HIGH' | 'MEDIUM' | 'LOW',
    public readonly stockDays: number,
    public readonly suggestedQty: number,
    public readonly correlationId?: string,
  ) {}
}

export class AiGovernanceBlockedEvent {
  constructor(
    public readonly tenantId: string,
    public readonly blockType: 'input' | 'output',
    public readonly reason: string,
    public readonly promptVersion: string,
    public readonly correlationId?: string,
  ) {}
}

export class RecommendationDismissedEvent {
  constructor(
    public readonly tenantId: string,
    public readonly recommendationId: string,
    public readonly feedbackScore: number | null,
    public readonly correlationId?: string,
  ) {}
}

// ── New enterprise order events ───────────────────────────────────────────────

export class OrderSubmittedEvent {
  constructor(
    public readonly orderId:          string,
    public readonly pharmacyTenantId: string,
    public readonly supplierTenantId: string,
    public readonly correlationId?:   string,
  ) {}
}

export class OrderApprovalRequiredEvent {
  constructor(
    public readonly orderId:          string,
    public readonly pharmacyTenantId: string,
    public readonly totalAmount:      number,
    public readonly correlationId?:   string,
  ) {}
}

export class OrderBackOrderedEvent {
  constructor(
    public readonly orderId:          string,
    public readonly pharmacyTenantId: string,
    public readonly supplierTenantId: string,
    public readonly reason?:          string,
    public readonly correlationId?:   string,
  ) {}
}

export class OrderDisputedEvent {
  constructor(
    public readonly orderId:          string,
    public readonly pharmacyTenantId: string,
    public readonly supplierTenantId: string,
    public readonly reason:           string,
    public readonly correlationId?:   string,
  ) {}
}

export class OrderReturnRequestedEvent {
  constructor(
    public readonly orderId:          string,
    public readonly pharmacyTenantId: string,
    public readonly supplierTenantId: string,
    public readonly returnRequestId:  string,
    public readonly correlationId?:   string,
  ) {}
}

export class OrderCreditIssuedEvent {
  constructor(
    public readonly orderId:          string,
    public readonly pharmacyTenantId: string,
    public readonly supplierTenantId: string,
    public readonly creditAmount:     number,
    public readonly correlationId?:   string,
  ) {}
}

export class OrderOnHoldEvent {
  constructor(
    public readonly orderId:          string,
    public readonly pharmacyTenantId: string,
    public readonly supplierTenantId: string,
    public readonly reason:           string,
    public readonly correlationId?:   string,
  ) {}
}

// ── Event name constants — use these in @OnEvent() decorators ────────────────
export const EVENTS = {
  INVENTORY_UPDATED:            'inventory.updated',
  RECOMMENDATION_GENERATED:     'recommendation.generated',
  ORDER_STATUS_CHANGED:         'order.status_changed',
  ORDER_DELIVERED:              'order.delivered',
  ORDER_SUBMITTED:              'order.submitted',
  ORDER_APPROVAL_REQUIRED:      'order.approval_required',
  ORDER_BACK_ORDERED:           'order.back_ordered',
  ORDER_DISPUTED:               'order.disputed',
  ORDER_RETURN_REQUESTED:       'order.return_requested',
  ORDER_CREDIT_ISSUED:          'order.credit_issued',
  ORDER_ON_HOLD:                'order.on_hold',
  SUPPLIER_STOCK_CHANGED:       'supplier.stock_changed',
  STOCK_RISK_DETECTED:          'stock.risk_detected',
  AI_GOVERNANCE_BLOCKED:        'ai.governance_blocked',
  RECOMMENDATION_DISMISSED:     'recommendation.dismissed',
  PRODUCT_RECALLED:             'product.recalled',
  BATCH_EXPIRY_ALERT:           'batch.expiry_alert',
  INVENTORY_NEAR_EXPIRY_DETECTED: 'inventory.near_expiry_detected',
  INVENTORY_LOW_STOCK_DETECTED:   'inventory.low_stock_detected',
  INVENTORY_STOCKOUT_DETECTED:    'inventory.stockout_detected',
  INVENTORY_PRICE_CHANGED:        'inventory.price_changed',
  POS_SALE_RECORDED:              'pos.sale_recorded',
} as const;

// ── P2P / Pharmacy Exchange Network events ────────────────────────────────────

export const P2P_EVENTS = {
  ORDER_CREATED:      'p2p.order.created',
  ORDER_ACCEPTED:     'p2p.order.accepted',
  ORDER_SHIPPED:      'p2p.order.shipped',
  ORDER_REJECTED:     'p2p.order.rejected',
  ORDER_COMPLETED:    'p2p.order.completed',
  ORDER_CANCELLED:    'p2p.order.cancelled',
  ORDER_DISPUTE_OPENED: 'p2p.order.dispute_opened',
  INVOICE_GENERATED:  'p2p.invoice.generated',
  PROFILE_SUBMITTED:  'p2p.profile.submitted',
  PROFILE_VERIFIED:   'p2p.profile.verified',
  PROFILE_REJECTED:   'p2p.profile.rejected',
} as const;

// ── Purchases / Supplier returns ──────────────────────────────────────────

export const PURCHASE_EVENTS = {
  /** A supplier return was confirmed — money recovered back from the supplier. */
  RETURN_CONFIRMED: 'purchase.return.confirmed',
} as const;

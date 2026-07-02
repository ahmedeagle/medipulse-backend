import { NotificationType } from './entities/notification.entity';

/**
 * Product-aligned notification categories used by the Notification Center.
 *
 * Kept on the backend so filtering + counts run at the database layer and the
 * center scales to very large notification volumes (no client-side scanning).
 * Mirrors the frontend grouping exactly so both surfaces stay consistent.
 */
export type NotificationCategory =
  | 'orders'
  | 'p2p'
  | 'purchases'
  | 'inventory'
  | 'system';

export const CATEGORY_TYPES: Record<NotificationCategory, NotificationType[]> = {
  orders: [
    'order_status_changed',
    'delivery_confirmed',
    'supplier_overdue',
    'draft_created',
  ],
  p2p: [
    'p2p_order_received',
    'p2p_order_accepted',
    'p2p_order_rejected',
    'p2p_order_completed',
    'p2p_order_cancelled',
    'p2p_order_shipped',
    'p2p_order_disputed',
    'p2p_invoice_ready',
    'p2p_listing_created',
    'p2p_profile_submitted',
    'p2p_profile_verified',
    'p2p_profile_rejected',
    'p2p_smart_procurement_opportunity',
    'p2p_order_action_required',
    'p2p_order_reminder',
    'p2p_pool_opportunity',
    'p2p_opportunity',
    'clearance_listing_available',
    'drug_need_broadcast',
    'drug_need_response',
  ],
  purchases: [
    'procurement_delay_suggested',
    'overpayment_alert',
    'market_shortage',
  ],
  inventory: [
    'high_risk_stockout',
    'low_stock',
    'reorder_deadline',
    'forecast_spike',
    'near_expiry',
    'expiry_digest',
    'expired_stock',
    'dead_stock',
    'dead_stock_warning',
    'inventory_batch_complete',
    'inventory_batch_failed',
  ],
  system: [
    'ai_governance_blocked',
    'approval_expiring',
    'morning_briefing',
    'usage_limit_reached',
    'system',
    'feature_request_update',
    'sales_history_upload_received',
    'pos_integrity_alert',
    'pos_integrity_resolved',
  ],
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_TYPES) as NotificationCategory[];

export function isNotificationCategory(v: string): v is NotificationCategory {
  return (ALL_CATEGORIES as string[]).includes(v);
}

export function typesForCategory(category: NotificationCategory): NotificationType[] {
  return CATEGORY_TYPES[category] ?? [];
}

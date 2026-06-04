export type NotificationType = 'high_risk_stockout' | 'order_status_changed' | 'draft_created' | 'supplier_overdue' | 'delivery_confirmed' | 'forecast_spike' | 'reorder_deadline' | 'dead_stock_warning' | 'system';
export declare class Notification {
    id: string;
    tenantId: string;
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    resourceRef: string;
    emailSent: boolean;
    isRead: boolean;
    readAt: Date;
    createdAt: Date;
}

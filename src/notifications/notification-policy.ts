import { NotificationType } from './entities/notification.entity';

/**
 * Notification decision model (PRD §6.2).
 *
 * Severity classifies how urgently a notification must reach the user; channels
 * are the delivery surfaces implied by that severity. This is applied centrally
 * in NotificationService.create(), so every producer — even the 30+ existing
 * direct callers — gets a consistent severity/channel decision WITHOUT changing
 * a single call site. Callers may still override explicitly when they know better.
 *
 * NOTE: `channels` is the *intended* routing (decision metadata). In-app + email
 * are delivered today; push/WhatsApp fan-out is intentionally NOT auto-triggered
 * here to avoid unsolicited blasts — a dispatcher can act on `channels` later.
 */
export type NotificationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type NotificationChannel = 'dashboard' | 'in_app' | 'push' | 'whatsapp';

/** Explicit severity for the types we classify; everything else defaults to medium. */
const SEVERITY_BY_TYPE: Partial<Record<NotificationType, NotificationSeverity>> = {
  // critical — money/safety/time-critical, must reach the user immediately
  high_risk_stockout:   'critical',
  pos_integrity_alert:  'critical',
  p2p_order_disputed:   'critical',
  drug_need_broadcast:  'critical',
  market_shortage:      'critical',

  // high — act today
  low_stock:            'high',
  near_expiry:          'high',
  expired_stock:        'high',
  approval_expiring:    'high',
  overpayment_alert:    'high',
  drug_need_response:   'high',
  p2p_order_received:   'high',

  // medium — normal operational flow
  dead_stock:                 'medium',
  clearance_listing_available:'medium',
  p2p_order_accepted:         'medium',
  p2p_order_shipped:          'medium',
  p2p_order_completed:        'medium',
  p2p_order_rejected:         'medium',
  p2p_order_cancelled:        'medium',
  procurement_delay_suggested:'medium',
  p2p_opportunity:            'medium',
  p2p_pool_opportunity:       'medium',

  // low — purely informational
  system:                     'low',
  morning_briefing:           'low',
  feature_request_update:     'low',
  sales_history_upload_received:'low',
};

const CHANNELS_BY_SEVERITY: Record<NotificationSeverity, NotificationChannel[]> = {
  low:      ['dashboard'],
  medium:   ['in_app'],
  high:     ['in_app', 'push'],
  critical: ['in_app', 'push', 'whatsapp'],
};

export function severityForType(type: NotificationType): NotificationSeverity {
  return SEVERITY_BY_TYPE[type] ?? 'medium';
}

export function channelsForSeverity(severity: NotificationSeverity): NotificationChannel[] {
  return CHANNELS_BY_SEVERITY[severity];
}

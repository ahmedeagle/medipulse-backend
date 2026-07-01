import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type NotificationType =
  | 'high_risk_stockout'
  | 'order_status_changed'
  | 'draft_created'
  | 'supplier_overdue'
  | 'delivery_confirmed'
  | 'forecast_spike'
  | 'reorder_deadline'
  | 'dead_stock_warning'
  | 'inventory_batch_complete'
  | 'inventory_batch_failed'
  | 'morning_briefing'
  | 'ai_governance_blocked'
  | 'approval_expiring'   // pending AI approvals about to expire unactioned
  | 'usage_limit_reached' // monthly AI or WhatsApp credits exhausted
  | 'system'
  // ── PEN (Pharmacy Exchange Network) ───────────────────────────────────────
  | 'p2p_order_received'
  | 'p2p_order_accepted'
  | 'p2p_order_rejected'
  | 'p2p_order_completed'
  | 'p2p_order_cancelled'
  | 'p2p_order_shipped'
  | 'p2p_order_disputed'
  | 'p2p_invoice_ready'
  | 'p2p_profile_submitted'
  | 'p2p_profile_verified'
  | 'p2p_profile_rejected'
  | 'p2p_smart_procurement_opportunity'
  // ── Expiry ────────────────────────────────────────────────────────────────
  | 'near_expiry'        // single item urgency crossing a threshold
  | 'expiry_digest'      // daily summary of all expiring items
  | 'expired_stock'      // items that are already past expiry date — must be removed
  // ── Inventory Health ──────────────────────────────────────────────────────
  | 'low_stock'          // item dropped below minThreshold
  | 'dead_stock'         // weekly dead-stock digest (high urgency items)
  // ── Feature Requests ─────────────────────────────────────────────────────
  | 'feature_request_update'   // chat feature request status changed (in_progress / resolved)
  // ── Onboarding ────────────────────────────────────────────────────────────
  | 'sales_history_upload_received'  // pharmacy uploaded historical sales/purchase files for ops to process
  // ── P2P AI Monitor ────────────────────────────────────────────────────────
  | 'p2p_order_action_required' // AI detected a stale/stuck order needing attention
  | 'p2p_order_reminder'        // nudge sent to seller to ship/respond
  // ── POS Integrity ─────────────────────────────────────────────────────────
  | 'pos_integrity_alert'         // cash mismatch or high refund rate flagged
  | 'pos_integrity_resolved'      // manager reviewed and acknowledged
  // ── Expiry Liquidation ────────────────────────────────────────────────────
  | 'clearance_listing_available'  // buyer notification: a clearance deal is live for a product they need
  | 'market_shortage'              // network-wide supply shortage detected for ≥1 products
  | 'overpayment_alert'            // pharmacy paying above market avg for a product
  // ── Decision Engine (P1 auto-draft outcomes) ──────────────────────────────
  | 'procurement_delay_suggested'  // orchestrator suggests delaying purchase for cash-flow reasons
  | 'p2p_opportunity'              // orchestrator found a cheaper P2P alternative
  | 'p2p_pool_opportunity'         // regional pooling: a nearby pharmacy needs your surplus → list it
  // ── Demand Broadcast ("أحتاج دواء") ───────────────────────────────────────
  | 'drug_need_broadcast'          // nearby pharmacy needs a drug you hold in stock → respond
  | 'drug_need_response';          // requester notification: a nearby pharmacy can supply your need

/**
 * In-app notification per user.
 * Email is sent separately by NotificationEmailService.
 * Kept in main DB — read performance critical (bell badge on every page load).
 */
@Entity('notifications')
@Index(['tenantId', 'userId', 'isRead', 'createdAt'])
@Index(['tenantId', 'userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  /** Deep link target: e.g. "order:uuid", "recommendation:uuid", "draft:uuid" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  resourceRef: string;

  /** Urgency class driving delivery (low | medium | high | critical). */
  @Column({ type: 'varchar', length: 12, nullable: true })
  severity: string | null;

  /** Intended delivery surfaces implied by severity (dashboard/in_app/push/whatsapp). */
  @Column({ type: 'jsonb', nullable: true })
  channels: string[] | null;

  /** Whether email was also sent */
  @Column({ type: 'boolean', default: false })
  emailSent: boolean;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

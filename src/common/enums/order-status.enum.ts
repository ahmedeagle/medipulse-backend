export enum OrderStatus {
  // ── Initiation ──────────────────────────────────────────────────────────────
  DRAFT              = 'draft',              // auto-generated, not yet submitted
  PENDING_APPROVAL   = 'pending_approval',   // awaiting director sign-off (> approval threshold)
  SUBMITTED          = 'submitted',          // pharmacy submitted, supplier reviewing

  // ── Negotiation ──────────────────────────────────────────────────────────────
  COUNTER_OFFER      = 'counter_offer',      // supplier proposes different qty/price

  // ── Supplier handling ─────────────────────────────────────────────────────────
  ACCEPTED           = 'accepted',           // supplier confirms fulfillment
  BACK_ORDERED       = 'back_ordered',       // supplier out of stock, will ship when available

  // ── Logistics ─────────────────────────────────────────────────────────────────
  SHIPPED            = 'shipped',
  FAILED_DELIVERY    = 'failed_delivery',    // driver could not deliver, needs reschedule
  ON_HOLD            = 'on_hold',            // suspended — payment dispute or stock hold

  // ── Receipt & QC ─────────────────────────────────────────────────────────────
  RECEIVED_PENDING_QC = 'received_pending_qc', // goods arrived, pharmacy inspecting

  // ── Completion ───────────────────────────────────────────────────────────────
  DELIVERED           = 'delivered',
  PARTIALLY_DELIVERED = 'partially_delivered',

  // ── Dispute & Return ─────────────────────────────────────────────────────────
  DISPUTED           = 'disputed',
  RETURN_REQUESTED   = 'return_requested',
  RETURN_APPROVED    = 'return_approved',
  RETURN_IN_TRANSIT  = 'return_in_transit',
  RETURN_RECEIVED    = 'return_received',
  CREDIT_ISSUED      = 'credit_issued',      // terminal — supplier issued credit note

  // ── Terminals ─────────────────────────────────────────────────────────────────
  CANCELLED          = 'cancelled',          // terminal — from SUBMITTED/ACCEPTED only
}

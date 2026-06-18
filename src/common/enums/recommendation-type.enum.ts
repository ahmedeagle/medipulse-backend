export enum RecommendationType {
  REORDER             = 'reorder',
  PRICE_COMPARISON    = 'price_comparison',
  ALTERNATIVE         = 'alternative',
  DEAD_STOCK_ALERT    = 'dead_stock_alert',
  CONSUMPTION_SPIKE   = 'consumption_spike',
  FORECAST_ALERT      = 'forecast_alert',       // demand spike predicted in next 14 days
  LIQUIDATION         = 'liquidation',          // dead stock with actionable financial impact
  REORDER_SCHEDULE    = 'reorder_schedule',     // proactive "order by DATE" before hitting reorder point
  INSUFFICIENT_DATA      = 'insufficient_data',
  // ── PEN (Pharmacy Exchange Network) ───────────────────────────────────────
  INTER_BRANCH_TRADE     = 'inter_branch_trade',    // excess at PharmacyA matches shortage at PharmacyB
  P2P_LISTING_SUGGESTION = 'p2p_listing_suggestion', // dead/near-expiry stock → suggest listing on PEN
  SMART_PROCUREMENT      = 'smart_procurement',     // P2P price beats supplier catalog for a reorder item
  // ── Compliance ───────────────────────────────────────────────────────────
  EXPIRED_QUARANTINE     = 'expired_quarantine',    // item past expiry date — must be quarantined/removed
}

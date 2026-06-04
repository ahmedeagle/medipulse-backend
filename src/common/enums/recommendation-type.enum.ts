export enum RecommendationType {
  REORDER             = 'reorder',
  PRICE_COMPARISON    = 'price_comparison',
  ALTERNATIVE         = 'alternative',
  DEAD_STOCK_ALERT    = 'dead_stock_alert',
  CONSUMPTION_SPIKE   = 'consumption_spike',
  FORECAST_ALERT      = 'forecast_alert',       // demand spike predicted in next 14 days
  LIQUIDATION         = 'liquidation',          // dead stock with actionable financial impact
  REORDER_SCHEDULE    = 'reorder_schedule',     // proactive "order by DATE" before hitting reorder point
  INSUFFICIENT_DATA   = 'insufficient_data',   // < 4 weeks of order history — predictions unreliable
}

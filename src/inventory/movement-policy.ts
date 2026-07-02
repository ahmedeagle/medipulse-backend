/**
 * Canonical movement/dead-stock thresholds used across inventory APIs/jobs.
 *
 * Business rule guardrail:
 * - Never infer movement/dead-stock from row `updatedAt`.
 * - Always derive from consumption snapshots / sales movement signals.
 */
export const MOVEMENT_POLICY = {
  /** Window used to decide whether the item moved recently. */
  consumptionWindowDays: 56, // 8 weeks
  /** Maximum history scanned to find the last positive-sale week. */
  movementLookbackDays: 180,
  /** <= this many days since last sale => active mover. */
  activeDays: 14,
  /** <= this many days since last sale => moderate mover. */
  moderateDays: 56,
  /** >= this many days since last sale + zero 8w consumption => dead stock. */
  deadStockDays: 56,
} as const;

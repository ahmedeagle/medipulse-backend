import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface CashFlowProjection {
  /** Horizon in days from today (1..30). */
  horizonDays: number;

  /**
   * Estimated total cash inflow over the horizon (in tenant currency).
   * = projected POS revenue + outstanding A/R expected to settle.
   */
  totalProjectedInflow: number;

  /** Best-effort breakdown for explainability in the UI. */
  components: {
    posRevenueBaseline: number;     // average POS daily revenue × horizon
    accountsReceivable: number;     // currently outstanding A/R
    creditResetExpected: number;    // credit limit freed by upcoming supplier settlements
  };

  /** Smallest number of days at which projected inflow first covers a target amount. */
  daysToCoverFn: (target: number) => number | null;

  /** Source flag for audit + confidence display. */
  source: 'baseline_pos' | 'insufficient_history';

  /** Number of distinct days of POS history used to compute the baseline. */
  baselineDays: number;
}

/**
 * Pure-SQL, rule-based cash-flow projector.
 *
 * What it answers:
 *   "If the pharmacy delays this purchase by N days, will they have enough
 *    cash to pay for it without entering high credit utilization?"
 *
 * What it deliberately does NOT do:
 *   - LLM-based reasoning (this runs on every procurement plan; AI cost
 *     would be unbounded).
 *   - Seasonality / trend (the 28-day rolling baseline already absorbs
 *     normal weekly cycles; longer horizons belong in the forecasting
 *     module, not here).
 *
 * Inputs:
 *   - pos_transactions.totalAmount (last 28 days, completed sales) → baseline
 *   - financial_ledger_entries (AR debit minus credit per tenant) → outstanding A/R
 *   - credit_wallets (utilizedCredit released by upcoming settlement dates)
 *     — left as 0 in this iteration; settlement-date prediction is a
 *     follow-up that requires a supplier_settlements.dueDate index.
 *
 * Performance: two indexed reads, both keyed by tenant. Safe to call
 * synchronously inside the procurement orchestrator hot path.
 */
@Injectable()
export class CashFlowProjector {
  private readonly logger = new Logger(CashFlowProjector.name);

  /** Days of POS history used for the rolling baseline. 28 = 4 full weeks. */
  private readonly BASELINE_WINDOW_DAYS = 28;

  /** Minimum history before we trust the baseline; below this we report insufficient. */
  private readonly MIN_BASELINE_DAYS = 7;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async project(tenantId: string, horizonDays: number = 7): Promise<CashFlowProjection> {
    const horizon = Math.max(1, Math.min(30, horizonDays));

    const [posRow] = await this.ds.query(
      `SELECT COALESCE(SUM("totalAmount"), 0)::float                    AS sum_total,
              COUNT(DISTINCT DATE_TRUNC('day', "createdAt"))::int       AS day_count
         FROM "pos_transactions"
        WHERE "pharmacyTenantId" = $1
          AND "status"           = 'completed'
          AND "type"             = 'sale'
          AND "createdAt"        >= NOW() - ($2::int || ' days')::interval`,
      [tenantId, this.BASELINE_WINDOW_DAYS],
    );
    const sumTotal = Number(posRow?.sum_total ?? 0);
    const baselineDays = Number(posRow?.day_count ?? 0);

    const avgDailyRevenue = baselineDays > 0 ? sumTotal / baselineDays : 0;
    const posRevenueBaseline = +(avgDailyRevenue * horizon).toFixed(2);

    // Outstanding A/R = sum(debit on AR) − sum(credit on AR).
    // Snake_case columns per the ledger entity.
    const [arRow] = await this.ds.query(
      `SELECT
          COALESCE(SUM("debit_amount"),  0)::float AS debits,
          COALESCE(SUM("credit_amount"), 0)::float AS credits
         FROM "financial_ledger_entries"
        WHERE "tenant_id"   = $1
          AND "account_type" = 'ar'`,
      [tenantId],
    );
    const accountsReceivable = Math.max(
      0,
      Number(arRow?.debits ?? 0) - Number(arRow?.credits ?? 0),
    );

    // Credit reset prediction is intentionally zero in this iteration —
    // see class doc. Wired in the breakdown so the UI shape is stable.
    const creditResetExpected = 0;

    const totalProjectedInflow = +(
      posRevenueBaseline + accountsReceivable + creditResetExpected
    ).toFixed(2);

    const source: CashFlowProjection['source'] =
      baselineDays >= this.MIN_BASELINE_DAYS ? 'baseline_pos' : 'insufficient_history';

    /**
     * Days to first cover a target. Linear interpolation on daily revenue
     * plus already-on-hand A/R. Returns null when even the full horizon's
     * projection cannot cover the target (caller treats this as "do not
     * delay").
     */
    const daysToCoverFn = (target: number): number | null => {
      if (target <= accountsReceivable) return 0;
      if (avgDailyRevenue <= 0) return null;
      const remaining = target - accountsReceivable;
      const days = Math.ceil(remaining / avgDailyRevenue);
      return days <= horizon ? days : null;
    };

    return {
      horizonDays: horizon,
      totalProjectedInflow,
      components: {
        posRevenueBaseline,
        accountsReceivable,
        creditResetExpected,
      },
      daysToCoverFn,
      source,
      baselineDays,
    };
  }
}

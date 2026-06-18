import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ApprovalService } from '../ai-governance/approval.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Runs every hour. Analyzes recently closed shifts for:
 *   - Cash mismatch: closing_balance vs system-expected
 *   - High refund rate: returns > 20% of sales
 *   - Excessive voids (when supported)
 *
 * Creates approval tasks for suspicious shifts via the existing
 * ApprovalService. Does NOT run synchronously during any POS operation.
 */
@Injectable()
export class PosIntegrityMonitorCron {
  private readonly logger = new Logger(PosIntegrityMonitorCron.name);

  // Thresholds
  private static readonly CASH_MISMATCH_THRESHOLD = 50;   // EGP
  private static readonly HIGH_REFUND_RATE        = 0.20; // 20% of sales
  private static readonly MIN_SALES_FOR_ANALYSIS  = 100;  // ignore tiny shifts

  constructor(
    private readonly dataSource:     DataSource,
    private readonly approvalService: ApprovalService,
    private readonly notifications:  NotificationService,
  ) {}

  @Cron('*/15 * * * *')
  async analyzeClosedShifts() {
    this.logger.debug('POS Integrity check started');
    try {
      await this.checkCashMismatches();
      await this.checkHighRefundRates();
    } catch (err) {
      this.logger.error('POS Integrity check failed', err?.message);
    }
  }

  /** Cash mismatch: closing_balance declared != system expected */
  private async checkCashMismatches() {
    const rows = await this.dataSource.query<any[]>(`
      SELECT
        s.id,
        s."pharmacyTenantId" AS "tenantId",
        s."cashierName",
        s."openingBalance",
        s."closingBalance",
        s."totalCashSales",
        s."totalCashIn",
        s."totalCashOut",
        s."totalSales",
        s."totalReturns",
        s."transactionCount",
        s."returnCount",
        s."openedAt",
        s."closedAt",
        -- System expected cash = opening + cash_in - cash_out + cash_sales - cash_returns_estimate
        (
          s."openingBalance"
          + s."totalCashIn"
          - s."totalCashOut"
          + s."totalCashSales"
        ) AS "systemExpected",
        ABS(
          s."closingBalance" - (
            s."openingBalance"
            + s."totalCashIn"
            - s."totalCashOut"
            + s."totalCashSales"
          )
        ) AS "variance"
      FROM pos_shifts s
      WHERE s.status = 'closed'
        AND s."closingBalance" IS NOT NULL
        AND s."closedAt" > NOW() - INTERVAL '24 hours'
        AND s."totalSales" >= $1
        AND ABS(
          s."closingBalance" - (
            s."openingBalance"
            + s."totalCashIn"
            - s."totalCashOut"
            + s."totalCashSales"
          )
        ) >= $2
        -- Skip if approval already exists for this shift
        AND NOT EXISTS (
          SELECT 1 FROM approvals a
          WHERE a."subjectType" = 'pos_shift_action'
            AND a."subjectId" = s.id
            AND a.payload->>'scenario' = 'cash_mismatch'
            AND a.status IN ('pending', 'modified')
        )
      ORDER BY "variance" DESC
      LIMIT 50
    `, [PosIntegrityMonitorCron.MIN_SALES_FOR_ANALYSIS, PosIntegrityMonitorCron.CASH_MISMATCH_THRESHOLD]);

    for (const row of rows) {
      const variance = Number(row.variance);
      const confidence = Math.min(0.99, 0.70 + variance / 1000);
      const priority = variance > 500 ? 'critical' : variance > 200 ? 'high' : 'medium';

      await this.approvalService.create(row.tenantId, {
        agentCode:   'pos_integrity',
        subjectType: 'pos_shift_action',
        subjectId:   row.id,
        title:     `فرق نقدي في شفت ${row.cashierName ?? 'كاشير'} — EGP ${variance.toFixed(2)}`,
        summary:   `الرصيد المُعلن: EGP ${Number(row.closingBalance).toFixed(2)} | المتوقع: EGP ${Number(row.systemExpected).toFixed(2)} | الفرق: EGP ${variance.toFixed(2)}`,
        rationale: `تم رصد فرق نقدي يتجاوز الحد المسموح (EGP ${PosIntegrityMonitorCron.CASH_MISMATCH_THRESHOLD}) عند إغلاق الشفت`,
        confidence,
        priority,
        expiresAt:   new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        payload: {
          scenario:        'cash_mismatch',
          shiftId:         row.id,
          cashierName:     row.cashierName,
          declaredBalance: Number(row.closingBalance),
          systemExpected:  Number(row.systemExpected),
          variance,
          totalSales:      Number(row.totalSales),
          transactionCount: row.transactionCount,
        },
      });

      await this.notifications.create({
        tenantId:    row.tenantId,
        type:        'pos_integrity_alert' as any,
        title:       'تنبيه: فرق نقدي في شفت مغلق',
        body:        `شفت الكاشير ${row.cashierName ?? '—'} يحتاج مراجعة — الفرق EGP ${variance.toFixed(2)}`,
        resourceRef: `pos_shift:${row.id}`,
      });

      this.logger.warn(`Cash mismatch flagged: shift ${row.id}, variance ${variance.toFixed(2)}`);
    }
  }

  /** High refund rate: total_returns / total_sales > threshold */
  private async checkHighRefundRates() {
    const rows = await this.dataSource.query<any[]>(`
      SELECT
        s.id,
        s."pharmacyTenantId" AS "tenantId",
        s."cashierName",
        s."totalSales",
        s."totalReturns",
        s."transactionCount",
        s."returnCount",
        s."openedAt",
        s."closedAt",
        ROUND(
          CASE WHEN s."totalSales" > 0
            THEN (s."totalReturns" / s."totalSales") * 100
            ELSE 0
          END, 1
        ) AS "refundRate"
      FROM pos_shifts s
      WHERE s.status = 'closed'
        AND s."closedAt" > NOW() - INTERVAL '24 hours'
        AND s."totalSales" >= $1
        AND s."totalReturns" > 0
        AND (s."totalReturns" / s."totalSales") >= $2
        AND NOT EXISTS (
          SELECT 1 FROM approvals a
          WHERE a."subjectType" = 'pos_shift_action'
            AND a."subjectId" = s.id
            AND a.payload->>'scenario' = 'high_refund_rate'
            AND a.status IN ('pending', 'modified')
        )
      LIMIT 20
    `, [PosIntegrityMonitorCron.MIN_SALES_FOR_ANALYSIS, PosIntegrityMonitorCron.HIGH_REFUND_RATE]);

    for (const row of rows) {
      const rate = Number(row.refundRate);
      const confidence = Math.min(0.99, 0.60 + (rate - 20) / 100);
      const priority = rate > 50 ? 'high' : 'medium';

      await this.approvalService.create(row.tenantId, {
        agentCode:   'pos_integrity',
        subjectType: 'pos_shift_action',
        subjectId:   row.id,
        title:     `نسبة مرتجعات عالية — ${rate}% في شفت ${row.cashierName ?? 'كاشير'}`,
        summary:   `مرتجعات: EGP ${Number(row.totalReturns).toFixed(2)} من إجمالي مبيعات EGP ${Number(row.totalSales).toFixed(2)} (${rate}%)`,
        rationale: `نسبة المرتجعات تتجاوز ${PosIntegrityMonitorCron.HIGH_REFUND_RATE * 100}% من إجمالي المبيعات وتستوجب المراجعة`,
        confidence,
        priority,
        expiresAt:   new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        payload: {
          scenario:         'high_refund_rate',
          shiftId:          row.id,
          cashierName:      row.cashierName,
          totalSales:       Number(row.totalSales),
          totalReturns:     Number(row.totalReturns),
          refundRate:       rate,
          transactionCount: row.transactionCount,
          returnCount:      row.returnCount,
        },
      });

      this.logger.warn(`High refund rate flagged: shift ${row.id}, rate ${rate}%`);
    }
  }

  /** Manual trigger for testing */
  async runNow() {
    return this.analyzeClosedShifts();
  }
}

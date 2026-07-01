import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ApprovalService } from '../ai-governance/approval.service';
import { NotificationService } from '../notifications/notification.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';
import { IsolationForest } from './anomaly/isolation-forest';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

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

  // ── Behavioural anomaly (Isolation Forest) layer ─────────────────────────
  // Optional, OFF by default. Runs ON TOP of the deterministic rules above and
  // only ever raises a review flag — it can never block a POS operation.
  private static readonly ANOMALY_MIN_BASELINE = 8;    // need history to learn “normal”
  private static readonly ANOMALY_THRESHOLD    = 0.68; // isolation score 0..1

  constructor(
    private readonly dataSource:     DataSource,
    private readonly approvalService: ApprovalService,
    private readonly notifications:  NotificationService,
    private readonly settingsSvc:    PharmacySettingsService,
    private readonly config:         ConfigService,
    private readonly cronLock:       CronLockService,
  ) {}

  @Cron('*/15 * * * *')
  async analyzeClosedShifts() {
    // Single-flight across processes/pods — only one runs per interval.
    const acquired = await this.cronLock.acquire('pos_integrity_monitor', 600);
    if (!acquired) return;

    this.logger.debug('POS Integrity check started');
    try {
      await this.checkCashMismatches();
      await this.checkHighRefundRates();
      await this.checkBehavioralAnomalies();
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

      if (await this.settingsSvc.getNotifFlag(row.tenantId, 'enablePosIntegrityAlerts')) {
        await this.notifications.create({
          tenantId:    row.tenantId,
          type:        'pos_integrity_alert' as any,
          title:       'تنبيه: فرق نقدي في شفت مغلق',
          body:        `شفت الكاشير ${row.cashierName ?? '—'} يحتاج مراجعة — الفرق EGP ${variance.toFixed(2)}`,
          resourceRef: `pos_shift:${row.id}`,
        });
      }

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

  /**
   * OPTIONAL behavioural anomaly layer (Isolation Forest).
   *
   * Learns each cashier's own recent "normal" shift profile and flags shifts
   * that deviate sharply — catching subtle drift the fixed cash/refund
   * thresholds miss (e.g. consistently small under-rings, creeping void rates).
   *
   * Trust contract:
   *  - DISABLED unless POS_ANOMALY_DETECTION_ENABLED=true (per-tenant
   *    enablePosIntegrityAlerts still respected for the notification).
   *  - Only raises a review flag/notification — never blocks any POS action.
   *  - Skips shifts already flagged by the deterministic rules (no double flag).
   *  - Any failure is swallowed; the proven rule checks are unaffected.
   */
  private async checkBehavioralAnomalies() {
    const flag = (this.config.get<string>('POS_ANOMALY_DETECTION_ENABLED') || '').toLowerCase();
    if (!(flag === 'true' || flag === '1' || flag === 'yes')) return;

    // SCALE: process one tenant at a time so a global row cap can never starve
    // some tenants of analysis. Only tenants that actually closed a shift in the
    // last 24h have anything new to score, so we drive the loop off that set.
    const tenants = await this.dataSource.query<{ tenantId: string }[]>(`
      SELECT DISTINCT s."pharmacyTenantId" AS "tenantId"
      FROM pos_shifts s
      WHERE s.status = 'closed'
        AND s."closedAt" > NOW() - INTERVAL '24 hours'
        AND s."totalSales" >= $1
    `, [PosIntegrityMonitorCron.MIN_SALES_FOR_ANALYSIS]);

    for (const { tenantId } of tenants) {
      try {
        await this.checkBehavioralAnomaliesForTenant(tenantId);
      } catch (err) {
        // Error-isolate: one tenant's failure must not abort the rest.
        this.logger.error(
          `Behavioral anomaly scan failed for tenant ${tenantId}: ${(err as Error)?.message}`,
        );
      }
    }
  }

  /** Per-tenant behavioural anomaly scan (bounded, self-contained). */
  private async checkBehavioralAnomaliesForTenant(tenantId: string) {
    // Pull this tenant's recent closed shifts (60d) with the raw aggregates we
    // turn into scale-free behavioural features. Bounded per tenant.
    const rows = await this.dataSource.query<any[]>(`
      SELECT
        s.id,
        s."pharmacyTenantId" AS "tenantId",
        s."cashierId",
        s."cashierName",
        s."openingBalance",
        s."closingBalance",
        s."totalSales",
        s."totalReturns",
        s."totalCashIn",
        s."totalCashOut",
        s."totalCashSales",
        s."transactionCount",
        s."returnCount",
        s."closedAt"
      FROM pos_shifts s
      WHERE s."pharmacyTenantId" = $1
        AND s.status = 'closed'
        AND s."closedAt" > NOW() - INTERVAL '60 days'
        AND s."totalSales" >= $2
      ORDER BY s."cashierId", s."closedAt" ASC
      LIMIT 5000
    `, [tenantId, PosIntegrityMonitorCron.MIN_SALES_FOR_ANALYSIS]);

    if (rows.length === 0) return;

    // Group by cashier (already tenant-scoped by the query).
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const arr = groups.get(r.cashierId) ?? [];
      arr.push(r);
      groups.set(r.cashierId, arr);
    }

    const dayAgo = Date.now() - 24 * 3600 * 1000;

    for (const shifts of groups.values()) {
      const candidates = shifts.filter((s) => new Date(s.closedAt).getTime() >= dayAgo);
      if (candidates.length === 0) continue;

      // Baseline = the cashier's other recent shifts (their own "normal").
      const baseline = shifts.filter((s) => new Date(s.closedAt).getTime() < dayAgo);
      if (baseline.length < PosIntegrityMonitorCron.ANOMALY_MIN_BASELINE) continue;

      const forest = new IsolationForest(100, 256).fit(baseline.map((s) => this.shiftFeatures(s)));

      for (const cand of candidates) {
        const score = forest.score(this.shiftFeatures(cand));
        if (score < PosIntegrityMonitorCron.ANOMALY_THRESHOLD) continue;

        // Don't double-flag a shift already caught by the rule checks.
        const existing = await this.dataSource.query<any[]>(`
          SELECT 1 FROM approvals a
          WHERE a."subjectType" = 'pos_shift_action'
            AND a."subjectId" = $1
            AND a.status IN ('pending', 'modified')
          LIMIT 1
        `, [cand.id]);
        if (existing.length > 0) continue;

        const pct = Math.round(score * 100);
        const priority = score >= 0.8 ? 'high' : 'medium';

        await this.approvalService.create(cand.tenantId, {
          agentCode:   'pos_integrity',
          subjectType: 'pos_shift_action',
          subjectId:   cand.id,
          title:     `سلوك غير معتاد في شفت ${cand.cashierName ?? 'كاشير'} — درجة ${pct}٪`,
          summary:   `هذا الشفت يختلف بوضوح عن النمط المعتاد لنفس الكاشير (مبيعات/مرتجعات/نقدية). يُنصح بالمراجعة.`,
          rationale: `كشف نموذج رصد الشذوذ (Isolation Forest) انحرافًا عن السلوك التاريخي للكاشير بدرجة ${pct}٪.`,
          confidence:  Math.min(0.95, score),
          priority,
          expiresAt:   new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
          payload: {
            scenario:         'behavioral_anomaly',
            shiftId:          cand.id,
            cashierName:      cand.cashierName,
            anomalyScore:     Math.round(score * 1000) / 1000,
            baselineShifts:   baseline.length,
            totalSales:       Number(cand.totalSales),
            totalReturns:     Number(cand.totalReturns),
            transactionCount: cand.transactionCount,
          },
        });

        if (await this.settingsSvc.getNotifFlag(cand.tenantId, 'enablePosIntegrityAlerts')) {
          await this.notifications.create({
            tenantId:    cand.tenantId,
            type:        'pos_integrity_alert' as any,
            title:       'تنبيه: سلوك غير معتاد في شفت مغلق',
            body:        `شفت الكاشير ${cand.cashierName ?? '—'} يختلف عن نمطه المعتاد (درجة ${pct}٪) — يُنصح بالمراجعة.`,
            resourceRef: `pos_shift:${cand.id}`,
            dedupeWindowMs: 24 * 3600 * 1000,
          });
        }

        this.logger.warn(`Behavioral anomaly flagged: shift ${cand.id}, score ${score.toFixed(3)}`);
      }
    }
  }

  /**
   * Scale-free behavioural features for a shift. Ratios keep cashiers with
   * different volumes comparable and prevent the forest keying on raw size.
   */
  private shiftFeatures(s: any): number[] {
    const sales   = Math.max(1, Number(s.totalSales) || 0);
    const txCount = Math.max(1, Number(s.transactionCount) || 0);
    const expected =
      Number(s.openingBalance) + Number(s.totalCashIn) -
      Number(s.totalCashOut) + Number(s.totalCashSales);
    const cashVarianceRatio =
      s.closingBalance != null
        ? Math.abs(Number(s.closingBalance) - expected) / sales
        : 0;
    return [
      cashVarianceRatio,                              // cash drawer drift
      (Number(s.totalReturns) || 0) / sales,          // refund value ratio
      (Number(s.returnCount) || 0) / txCount,         // refund frequency
      sales / txCount,                                // average basket size
      (Number(s.totalCashSales) || 0) / sales,        // cash vs card mix
    ];
  }

  /** Manual trigger for testing */
  async runNow() {
    return this.analyzeClosedShifts();
  }
}

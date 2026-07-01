import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Approval } from './entities/approval.entity';
import { ApprovalEvent } from './entities/approval-event.entity';
import { RecoveryEventService, RecoverySummary } from '../recovery/recovery-event.service';

export type ReportPeriod = 'week' | 'month';

export interface ReportBucket {
  bucket: 'purchasing' | 'inventory' | 'p2p' | 'pos' | 'other';
  labelAr: string;
  created: number;
  executed: number;
  missed: number;
}

export interface AiCenterReport {
  period: ReportPeriod;
  since: string;
  /** Outcome funnel over the period. */
  proposed: number;   // approvals created in period
  approved: number;   // approve transitions in period
  executed: number;   // executed transitions in period
  rejected: number;   // reject transitions in period
  missed: number;     // expired-while-pending transitions in period
  realizedSavingsEgp: number;
  /** Persisted Financial Impact Measurement — durable, not computed on the fly. */
  recovery: RecoverySummary;
  byBucket: ReportBucket[];
  backlog: {
    pending: number;
    oldestPendingAgeHours: number | null;
    expiringNext24h: number;
  };
  avgTimeToDecideHours: number | null;
}

const BUCKET_OF: Record<string, ReportBucket['bucket']> = {
  smart_procurement: 'purchasing',
  procurement_draft: 'purchasing',
  procurement_basket: 'purchasing',
  low_stock: 'inventory',
  dead_stock_clearance: 'inventory',
  expiry_liquidation: 'inventory',
  expired_quarantine: 'inventory',
  inventory_item: 'inventory',
  recommendation: 'inventory',
  p2p_listing_suggestion: 'p2p',
  p2p_order_action: 'p2p',
  pos_shift_action: 'pos',
};

const BUCKET_LABEL_AR: Record<ReportBucket['bucket'], string> = {
  purchasing: 'الشراء',
  inventory: 'المخزون والصلاحية',
  p2p: 'سوق الصيدليات',
  pos: 'الكاشير',
  other: 'أخرى',
};

/**
 * ReportService — the AI Center impact/status report.
 *
 * Computed entirely from `approvals` + `approval_events` (no new tables) using
 * a handful of GROUP BY / FILTER aggregate queries run in parallel. Gives the
 * pharmacy a clear "what did the AI do, what did I miss, what did it save"
 * picture that the counts/audit views never surfaced.
 */
@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(Approval) private readonly repo: Repository<Approval>,
    @InjectRepository(ApprovalEvent) private readonly events: Repository<ApprovalEvent>,
    private readonly recovery: RecoveryEventService,
  ) {}

  async getReport(tenantId: string, period: ReportPeriod = 'week'): Promise<AiCenterReport> {
    const days = period === 'month' ? 30 : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [outcomes, proposedRow, savingsRow, byTypeRows, backlogRow, avgRow, recovery] = await Promise.all([
      // Outcome transitions in the period (accurate "what happened").
      this.events
        .createQueryBuilder('e')
        .select('e."toStatus"', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('e."tenantId" = :tenantId', { tenantId })
        .andWhere('e."createdAt" >= :since', { since })
        .andWhere(`e."toStatus" IN ('approved','rejected','executed','expired')`)
        .groupBy('e."toStatus"')
        .getRawMany<{ status: string; count: string }>(),

      // Proposed = approvals created in the period.
      this.repo
        .createQueryBuilder('a')
        .select('COUNT(*)', 'count')
        .where('a."tenantId" = :tenantId', { tenantId })
        .andWhere('a."createdAt" >= :since', { since })
        .getRawOne<{ count: string }>(),

      // Realized savings = executed procurement approvals in the period.
      this.repo
        .createQueryBuilder('a')
        .select(
          `COALESCE(SUM(COALESCE((a."payload"->'explainability'->'financialImpact'->>'savedVsHistoricalAvg')::numeric, 0)), 0)`,
          'saved',
        )
        .where('a."tenantId" = :tenantId', { tenantId })
        .andWhere(`a."status" = 'executed'`)
        .andWhere('a."executedAt" >= :since', { since })
        .andWhere(`a."subjectType" IN ('smart_procurement','procurement_draft')`)
        .getRawOne<{ saved: string }>(),

      // Per subjectType: created / executed / missed in the period.
      this.repo
        .createQueryBuilder('a')
        .select('a."subjectType"', 'subjectType')
        .addSelect(`COUNT(*) FILTER (WHERE a."createdAt" >= :since)`, 'created')
        .addSelect(`COUNT(*) FILTER (WHERE a."status" = 'executed' AND a."executedAt" >= :since)`, 'executed')
        .addSelect(`COUNT(*) FILTER (WHERE a."status" = 'expired' AND a."updatedAt" >= :since)`, 'missed')
        .where('a."tenantId" = :tenantId', { tenantId })
        .andWhere('(a."createdAt" >= :since OR a."updatedAt" >= :since)')
        .setParameter('since', since)
        .groupBy('a."subjectType"')
        .getRawMany<{ subjectType: string; created: string; executed: string; missed: string }>(),

      // Current backlog (not period-bound).
      this.repo
        .createQueryBuilder('a')
        .select(`COUNT(*) FILTER (WHERE a."status" IN ('pending','modified'))`, 'pending')
        .addSelect(`MIN(a."createdAt") FILTER (WHERE a."status" IN ('pending','modified'))`, 'oldestPendingAt')
        .addSelect(
          `COUNT(*) FILTER (WHERE a."status" IN ('pending','modified') AND a."expiresAt" IS NOT NULL AND a."expiresAt" < now() + interval '24 hours')`,
          'expiringNext24h',
        )
        .where('a."tenantId" = :tenantId', { tenantId })
        .getRawOne<{ pending: string; oldestPendingAt: string | null; expiringNext24h: string }>(),

      // Average time to decide (reviewed items in the period).
      this.repo
        .createQueryBuilder('a')
        .select(`AVG(EXTRACT(EPOCH FROM (a."reviewedAt" - a."createdAt")) / 3600.0)`, 'hrs')
        .where('a."tenantId" = :tenantId', { tenantId })
        .andWhere('a."reviewedAt" IS NOT NULL')
        .andWhere('a."reviewedAt" >= :since', { since })
        .getRawOne<{ hrs: string | null }>(),

      // Persisted recovery/impact summary (durable measurement layer).
      this.recovery.summary(tenantId, since),
    ]);

    const outcomeMap = new Map(outcomes.map((r) => [r.status, Number(r.count)]));

    // Aggregate subjectType rows into human buckets.
    const bucketMap = new Map<ReportBucket['bucket'], ReportBucket>();
    for (const row of byTypeRows) {
      const key = BUCKET_OF[row.subjectType] ?? 'other';
      const b =
        bucketMap.get(key) ??
        { bucket: key, labelAr: BUCKET_LABEL_AR[key], created: 0, executed: 0, missed: 0 };
      b.created += Number(row.created);
      b.executed += Number(row.executed);
      b.missed += Number(row.missed);
      bucketMap.set(key, b);
    }
    const byBucket = [...bucketMap.values()]
      .filter((b) => b.created || b.executed || b.missed)
      .sort((a, b) => b.created - a.created);

    const oldestPendingAt = backlogRow?.oldestPendingAt ? new Date(backlogRow.oldestPendingAt) : null;
    const oldestPendingAgeHours = oldestPendingAt
      ? Math.round(((Date.now() - oldestPendingAt.getTime()) / 3_600_000) * 10) / 10
      : null;

    const avgHrs = avgRow?.hrs != null ? Math.round(Number(avgRow.hrs) * 10) / 10 : null;

    return {
      period,
      since: since.toISOString(),
      proposed: Number(proposedRow?.count ?? 0),
      approved: outcomeMap.get('approved') ?? 0,
      executed: outcomeMap.get('executed') ?? 0,
      rejected: outcomeMap.get('rejected') ?? 0,
      missed: outcomeMap.get('expired') ?? 0,
      realizedSavingsEgp: Math.round(Number(savingsRow?.saved ?? 0)),
      recovery,
      byBucket,
      backlog: {
        pending: Number(backlogRow?.pending ?? 0),
        oldestPendingAgeHours,
        expiringNext24h: Number(backlogRow?.expiringNext24h ?? 0),
      },
      avgTimeToDecideHours: avgHrs,
    };
  }
}

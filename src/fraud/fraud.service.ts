import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';

import { Approval, ApprovalStatus } from '../ai-governance/entities/approval.entity';

export interface FraudSignal {
  signalType:
    | 'HIGH_DISCOUNT_RATE'
    | 'ORDER_CHURN_ABUSE'
    | 'RUBBER_STAMP_APPROVALS'
    | 'PRICE_DUMPING'
    | 'BULK_MULTI_SOURCE_ORDER';
  tenantId: string;
  severity: 'medium' | 'high' | 'critical';
  confidence: number;
  titleAr: string;
  summaryAr: string;
  rationale: string;
  evidence: Record<string, unknown>;
}

/**
 * Deterministic UUID derived from (tenantId + signalType).
 *
 * Stored in Approval.subjectId, which has a DB index on (subjectType, subjectId).
 * This gives O(log n) dedup lookups instead of a sequential JSONB payload scan.
 *
 * The same tenantId+signalType always maps to the same UUID, so once a pending
 * signal is dismissed/expired a new one can be raised (dedup checks status=pending).
 */
function signalSubjectId(tenantId: string, signalType: string): string {
  const hash = createHash('sha256').update(`fraud:${tenantId}:${signalType}`).digest('hex');
  // Format as UUID v4-like (schema requires UUID type)
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    @InjectRepository(Approval)
    private readonly approvalRepo: Repository<Approval>,
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Public entry point — call per-tenant
  // ─────────────────────────────────────────────────────────────────────────

  async scanTenant(tenantId: string): Promise<void> {
    const [r1, r2, r3, r4, r5] = await Promise.allSettled([
      this.ruleHighDiscountRate(tenantId),
      this.ruleOrderChurnAbuse(tenantId),
      this.ruleRubberStampApprovals(tenantId),
      this.rulePriceDumping(tenantId),
      this.ruleBulkMultiSourceOrder(tenantId),
    ]);

    const signals: FraudSignal[] = [];
    for (const r of [r1, r2, r3, r4, r5]) {
      if (r.status === 'fulfilled' && r.value) signals.push(r.value);
      if (r.status === 'rejected')
        this.logger.warn({ event: 'fraud.rule_error', tenantId, reason: String(r.reason) });
    }

    for (const sig of signals) {
      await this.persistSignal(sig);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 1: Aggressive discount pattern
  // ─────────────────────────────────────────────────────────────────────────
  private async ruleHighDiscountRate(tenantId: string): Promise<FraudSignal | null> {
    const rows = await this.dataSource.query<{ cnt: string }[]>(`
      SELECT COUNT(*)::int AS cnt
      FROM   p2p_listings
      WHERE  "sellerTenantId" = $1
        AND  "discountPct"    > 40
        AND  status           != 'cancelled'
        AND  "createdAt"      > NOW() - INTERVAL '30 days'
    `, [tenantId]);

    const cnt = Number(rows[0]?.cnt ?? 0);
    if (cnt < 4) return null;

    return {
      signalType: 'HIGH_DISCOUNT_RATE',
      tenantId,
      severity:   cnt >= 10 ? 'critical' : 'high',
      confidence: Math.min(0.5 + cnt * 0.05, 0.95),
      titleAr:    'معدل خصم مرتفع بشكل غير مألوف',
      summaryAr:  `تم رصد ${cnt} قائمة P2P بخصم يتجاوز 40 % خلال آخر 30 يوم. قد يشير ذلك إلى البيع بأقل من التكلفة أو التهرب الضريبي.`,
      rationale:  `Rule HIGH_DISCOUNT_RATE: ${cnt} listings with discountPct > 40% in 30 days (threshold: 4)`,
      evidence:   { listingCount: cnt, discountThreshold: 40, windowDays: 30 },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 2: Order churn abuse — place → cancel within 2 h repeatedly
  // ─────────────────────────────────────────────────────────────────────────
  private async ruleOrderChurnAbuse(tenantId: string): Promise<FraudSignal | null> {
    const rows = await this.dataSource.query<{ cnt: string }[]>(`
      SELECT COUNT(*)::int AS cnt
      FROM   p2p_orders
      WHERE  "buyerTenantId" = $1
        AND  status          = 'cancelled'
        AND  "createdAt"     > NOW() - INTERVAL '30 days'
        AND  EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) < 7200
    `, [tenantId]);

    const cnt = Number(rows[0]?.cnt ?? 0);
    if (cnt < 3) return null;

    return {
      signalType: 'ORDER_CHURN_ABUSE',
      tenantId,
      severity:   cnt >= 6 ? 'critical' : 'high',
      confidence: Math.min(0.55 + cnt * 0.06, 0.95),
      titleAr:    'إلغاء متكرر للطلبات بعد الحجز',
      summaryAr:  `تم رصد ${cnt} طلب P2P أُلغي خلال ساعتين من إنشائه في آخر 30 يوم، مما يحجب المخزون عن المشترين الآخرين.`,
      rationale:  `Rule ORDER_CHURN_ABUSE: ${cnt} orders cancelled within 2h of creation (threshold: 3)`,
      evidence:   { cancelledOrders: cnt, cancellationWindowHours: 2, windowDays: 30 },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 3: Rubber-stamp approvals — > 70 % decided in < 5 s (min 10 sample)
  // ─────────────────────────────────────────────────────────────────────────
  private async ruleRubberStampApprovals(tenantId: string): Promise<FraudSignal | null> {
    const rows = await this.dataSource.query<{ total: string; fast: string }[]>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE EXTRACT(EPOCH FROM ("reviewedAt" - "createdAt")) < 5
        )::int AS fast
      FROM  approvals
      WHERE "tenantId"   = $1
        AND "reviewedAt" IS NOT NULL
        AND  status      IN ('approved', 'rejected')
        AND "createdAt"  > NOW() - INTERVAL '7 days'
    `, [tenantId]);

    const total = Number(rows[0]?.total ?? 0);
    const fast  = Number(rows[0]?.fast  ?? 0);
    if (total < 10) return null;

    const ratio = fast / total;
    if (ratio < 0.70) return null;

    return {
      signalType: 'RUBBER_STAMP_APPROVALS',
      tenantId,
      severity:   ratio >= 0.90 ? 'critical' : 'high',
      confidence: Math.round(ratio * 100) / 100,
      titleAr:    'اعتماد توصيات الذكاء الاصطناعي دون مراجعة',
      summaryAr:  `${Math.round(ratio * 100)} % من قرارات الموافقة خلال آخر 7 أيام (${fast}/${total}) استغرقت أقل من 5 ثوانٍ، مما يشير إلى تجاوز نقطة المراجعة.`,
      rationale:  `Rule RUBBER_STAMP_APPROVALS: ${fast}/${total} decisions in < 5s (ratio: ${Math.round(ratio * 100)}%, threshold: 70%)`,
      evidence:   { fastDecisions: fast, totalDecisions: total, ratioPercent: Math.round(ratio * 100) },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 4: Price dumping — P2P listing < 70 % of own inventory cost price
  // ─────────────────────────────────────────────────────────────────────────
  private async rulePriceDumping(tenantId: string): Promise<FraudSignal | null> {
    const rows = await this.dataSource.query<{
      listing_id: string;
      listing_price: string;
      cost_price: string;
    }[]>(`
      SELECT l.id                     AS listing_id,
             l.price::float           AS listing_price,
             i."costPrice"::float     AS cost_price
      FROM   p2p_listings   l
      JOIN   inventory_items i
             ON  i."productId"        = l."productId"
             AND i."pharmacyTenantId" = l."sellerTenantId"
             AND i."deletedAt"        IS NULL
             AND i."costPrice"        > 0          -- division-safe: never zero
      WHERE  l."sellerTenantId" = $1
        AND  l.status           = 'active'
        AND  l.price::float     < i."costPrice"::float * 0.70
        AND  l."createdAt"      > NOW() - INTERVAL '30 days'
      LIMIT  10
    `, [tenantId]);

    if (!rows.length) return null;

    // Additional defence: skip any row where cost_price ended up zero (shouldn't happen given SQL filter)
    const valid = rows.filter((r) => Number(r.cost_price) > 0);
    if (!valid.length) return null;

    const worst = valid.reduce((a, b) =>
      Number(a.listing_price) / Number(a.cost_price) < Number(b.listing_price) / Number(b.cost_price) ? a : b,
    );
    const worstRatio = Math.round((Number(worst.listing_price) / Number(worst.cost_price)) * 100);

    return {
      signalType: 'PRICE_DUMPING',
      tenantId,
      severity:   valid.length >= 3 ? 'critical' : 'high',
      confidence: Math.min(0.6 + valid.length * 0.08, 0.97),
      titleAr:    'بيع P2P بأقل من سعر التكلفة',
      summaryAr:  `رُصدت ${valid.length} قائمة P2P بسعر أقل من 70 % من سعر التكلفة. أدنى نسبة: ${worstRatio} % من التكلفة.`,
      rationale:  `Rule PRICE_DUMPING: ${valid.length} listings priced < 70% of cost (worst: ${worstRatio}%)`,
      evidence:   { dumpedListings: valid.length, worstPriceRatioPct: worstRatio, sampleListingId: worst.listing_id },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 5: Bulk multi-source ordering — same product, ≥ 3 sellers, 24 h
  // ─────────────────────────────────────────────────────────────────────────
  private async ruleBulkMultiSourceOrder(tenantId: string): Promise<FraudSignal | null> {
    const rows = await this.dataSource.query<{
      product_id: string;
      seller_count: string;
      total_qty: string;
    }[]>(`
      SELECT  l."productId"                      AS product_id,
              COUNT(DISTINCT o."sellerTenantId") AS seller_count,
              SUM(o."requestedQty")              AS total_qty
      FROM    p2p_orders   o
      JOIN    p2p_listings l ON l.id = o."listingId"
      WHERE   o."buyerTenantId" = $1
        AND   o."createdAt"     > NOW() - INTERVAL '24 hours'
        AND   o.status          NOT IN ('cancelled', 'rejected')
      GROUP BY l."productId"
      HAVING   COUNT(DISTINCT o."sellerTenantId") >= 3
    `, [tenantId]);

    if (!rows.length) return null;

    const topProduct = rows.reduce((a, b) =>
      Number(a.seller_count) > Number(b.seller_count) ? a : b,
    );

    return {
      signalType: 'BULK_MULTI_SOURCE_ORDER',
      tenantId,
      severity:   Number(topProduct.seller_count) >= 5 ? 'critical' : 'high',
      confidence: Math.min(0.5 + Number(topProduct.seller_count) * 0.1, 0.9),
      titleAr:    'طلب كميات كبيرة من مصادر متعددة',
      summaryAr:  `طلب المشتري نفس المنتج من ${topProduct.seller_count} بائعين مختلفين خلال 24 ساعة (${topProduct.total_qty} وحدة). قد يدل على اكتناز أو إعادة بيع.`,
      rationale:  `Rule BULK_MULTI_SOURCE_ORDER: ordered same product from ${topProduct.seller_count} sellers in 24h`,
      evidence:   {
        productId:      topProduct.product_id,
        sellerCount:    Number(topProduct.seller_count),
        totalQty:       Number(topProduct.total_qty),
        affectedProducts: rows.length,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistence — O(log n) dedup via indexed (subjectType, subjectId) column
  // ─────────────────────────────────────────────────────────────────────────
  private async persistSignal(sig: FraudSignal): Promise<void> {
    // Deterministic subjectId uses the existing @Index(['subjectType','subjectId'])
    // for a fast index scan instead of a sequential JSONB payload scan.
    const subjectId = signalSubjectId(sig.tenantId, sig.signalType);

    const existing = await this.approvalRepo.findOne({
      where: {
        subjectType: 'fraud_signal',
        subjectId,
        status:      'pending' as ApprovalStatus,
        tenantId:    sig.tenantId,
      },
    });

    if (existing) return; // open signal already exists — respect analyst's workload

    const priorityMap: Record<FraudSignal['severity'], 'medium' | 'high' | 'critical'> = {
      medium:   'medium',
      high:     'high',
      critical: 'critical',
    };

    await this.approvalRepo.save(
      this.approvalRepo.create({
        id:              uuid(),
        tenantId:        sig.tenantId,
        agentCode:       'fraud_detector',
        subjectType:     'fraud_signal',
        subjectId,
        title:           sig.titleAr,
        summary:         sig.summaryAr,
        rationale:       sig.rationale,
        confidence:      sig.confidence,
        confidenceLabel: sig.confidence >= 0.85 ? 'very_high' : sig.confidence >= 0.70 ? 'high' : 'medium',
        confidenceReason: `Rule ${sig.signalType} — confidence ${Math.round(sig.confidence * 100)}%`,
        priority:        priorityMap[sig.severity],
        status:          'pending',
        createdByAgent:  'fraud_detector',
        payload:         { ...sig.evidence, signalType: sig.signalType, severity: sig.severity },
        originalPayload: null,
        expiresAt:       new Date(Date.now() + 14 * 86_400_000),
      }),
    );

    this.logger.warn(JSON.stringify({
      event:      'fraud.signal_created',
      tenantId:   sig.tenantId,
      signalType: sig.signalType,
      severity:   sig.severity,
      confidence: sig.confidence,
    }));
  }
}

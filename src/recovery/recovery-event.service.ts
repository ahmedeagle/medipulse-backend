import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  RecoveryEvent,
  RecoveryEventType,
  RecoveryEventStatus,
  RecoverySourceType,
} from './entities/recovery-event.entity';

export interface RecordRecoveryDto {
  pharmacyTenantId: string;
  type: RecoveryEventType;
  status?: RecoveryEventStatus;     // default 'realized'
  amountEgp?: number;               // realized money captured (default 0)
  expectedValueEgp?: number | null; // value at risk / expected recovery
  realizedValueEgp?: number | null;
  productId?: string | null;
  sourceType: RecoverySourceType;
  sourceId?: string | null;         // idempotency key with (sourceType, type)
  subjectType?: string | null;
  metadata?: Record<string, any> | null;
}

export interface RecoverySummary {
  since: string;
  realizedEgp: number;   // money actually captured
  pipelineEgp: number;   // projected recovery not yet realized
  lostEgp: number;       // projected recovery that closed unrecovered (lost/expired)
  byType: Array<{ type: RecoveryEventType; realizedEgp: number; pipelineEgp: number; lostEgp: number; count: number }>;
}

@Injectable()
export class RecoveryEventService {
  private readonly logger = new Logger(RecoveryEventService.name);

  constructor(
    @InjectRepository(RecoveryEvent)
    private readonly repo: Repository<RecoveryEvent>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Idempotent write. A duplicate (sourceType, sourceId, type) is silently ignored
   * via ON CONFLICT DO NOTHING, so an executor/cron that fires twice never
   * double-counts. Never throws into the caller's execution path — recording impact
   * must not break the business action it measures.
   */
  async record(dto: RecordRecoveryDto): Promise<void> {
    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(RecoveryEvent)
        .values({
          pharmacyTenantId: dto.pharmacyTenantId,
          type: dto.type,
          status: dto.status ?? 'realized',
          amountEgp: dto.amountEgp ?? 0,
          expectedValueEgp: dto.expectedValueEgp ?? null,
          realizedValueEgp: dto.realizedValueEgp ?? null,
          productId: dto.productId ?? null,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId ?? null,
          subjectType: dto.subjectType ?? null,
          metadata: dto.metadata ?? null,
        })
        .orIgnore() // ON CONFLICT DO NOTHING (uq_recovery_source)
        .execute();
    } catch (err) {
      this.logger.warn(
        `recovery record failed (${dto.type}/${dto.sourceId ?? 'n/a'}): ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Close the loop: a completed P2P order turns a *projected* recovery (near-expiry
   * / dead-stock surplus the seller listed) into *realized* money captured.
   *
   * Honest by design — we ONLY realize when there is a matching open projected AI
   * recovery event for the sold listing. An ordinary P2P sale that the AI never
   * flagged is NOT counted as "recovery" (no guessing, no inflating ROI with
   * normal revenue).
   *
   * Scale + correctness:
   *   • One indexed PK lookup for the order, one partial-index lookup for the open
   *     projection (idx_recovery_listing_open, WHERE status='projected'), so cost is
   *     O(log n) regardless of ledger size.
   *   • Idempotent: the realized row is UNIQUE on (sourceType='order', orderId, type)
   *     and the pipeline is decremented ONLY when that insert actually created a row,
   *     so a re-fired ORDER_COMPLETED can never double-count nor double-decrement.
   *   • Partial sales safe: pipeline is reduced proportionally to the sold quantity;
   *     multiple orders against one listing each realize their own slice.
   *   • Never throws into the event pipeline — measurement must not break the order flow.
   */
  async finalizeP2pOrderCompletion(orderId: string): Promise<void> {
    if (!orderId) return;
    try {
      await this.dataSource.transaction(async (trx) => {
        const [order] = await trx.query(
          `SELECT id, "sellerTenantId", "listingId", "requestedQty", "agreedPrice"
             FROM p2p_orders
            WHERE id = $1 AND status = 'completed'
            LIMIT 1`,
          [orderId],
        );
        if (!order) return;

        const soldQty = Number(order.requestedQty);
        const realizedTotal = soldQty * Number(order.agreedPrice);
        if (!(realizedTotal > 0)) return;

        // Newest still-open projected AI recovery event for this listing (partial index).
        const [proj] = await trx.query(
          `SELECT id, type, "productId", "expectedValueEgp",
                  COALESCE((metadata->>'quantity')::numeric, 0) AS listed_qty
             FROM ai_recovery_events
            WHERE "pharmacyTenantId" = $1
              AND status = 'projected'
              AND "expectedValueEgp" > 0
              AND metadata->>'listingId' = $2
            ORDER BY "createdAt" DESC
            LIMIT 1`,
          [order.sellerTenantId, order.listingId],
        );
        if (!proj) return; // ordinary sale — not an AI-driven recovery; stay honest.

        // Realized money captured — separate row, never mixed into the projected one.
        const inserted = await trx.query(
          `INSERT INTO ai_recovery_events
             ("pharmacyTenantId", type, status, "amountEgp", "realizedValueEgp",
              "productId", "sourceType", "sourceId", "subjectType", metadata)
           VALUES ($1, $2, 'realized', $3, $3, $4, 'order', $5, 'p2p_order_completed', $6::jsonb)
           ON CONFLICT ("sourceType", "sourceId", type) DO NOTHING
           RETURNING id`,
          [
            order.sellerTenantId,
            proj.type,
            realizedTotal,
            proj.productId,
            order.id,
            JSON.stringify({
              listingId: order.listingId,
              orderId: order.id,
              quantity: soldQty,
              unitPrice: Number(order.agreedPrice),
              projectedFrom: proj.id,
            }),
          ],
        );
        if (!inserted.length) return; // duplicate completion — pipeline already reduced.

        // Shrink the pipeline by exactly the sold slice (never below zero).
        const listedQty = Number(proj.listed_qty) || 0;
        const expected = Number(proj.expectedValueEgp);
        const decrement =
          listedQty > 0 ? Math.min((expected / listedQty) * soldQty, expected) : expected;
        await trx.query(
          `UPDATE ai_recovery_events
              SET "expectedValueEgp" = GREATEST("expectedValueEgp" - $2, 0)
            WHERE id = $1`,
          [proj.id, decrement],
        );

        this.logger.log(
          `recovery realized: order ${order.id} → ${proj.type} +${realizedTotal.toFixed(2)} EGP (pipeline -${decrement.toFixed(2)})`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `recovery finalize failed (order ${orderId}): ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Grouped time-range aggregation. Covered by idx_recovery_tenant_type_created,
   * so it's an index-only range scan even with millions of rows per tenant.
   */
  async summary(tenantId: string, since: Date): Promise<RecoverySummary> {
    const rows = await this.repo
      .createQueryBuilder('e')
      .select('e.type', 'type')
      .addSelect(`COALESCE(SUM(CASE WHEN e.status = 'realized' THEN e."amountEgp" ELSE 0 END), 0)`, 'realized')
      .addSelect(`COALESCE(SUM(CASE WHEN e.status = 'projected' THEN COALESCE(e."expectedValueEgp", 0) ELSE 0 END), 0)`, 'pipeline')
      .addSelect(`COALESCE(SUM(CASE WHEN e.status IN ('lost','expired') THEN COALESCE(e."expectedValueEgp", 0) ELSE 0 END), 0)`, 'lost')
      .addSelect('COUNT(*)', 'count')
      .where('e.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('e.createdAt >= :since', { since })
      .groupBy('e.type')
      .getRawMany<{ type: RecoveryEventType; realized: string; pipeline: string; lost: string; count: string }>();

    let realizedEgp = 0;
    let pipelineEgp = 0;
    let lostEgp = 0;
    const byType = rows.map((r) => {
      const realized = Number(r.realized);
      const pipeline = Number(r.pipeline);
      const lost = Number(r.lost);
      realizedEgp += realized;
      pipelineEgp += pipeline;
      lostEgp += lost;
      return { type: r.type, realizedEgp: realized, pipelineEgp: pipeline, lostEgp: lost, count: Number(r.count) };
    });

    return { since: since.toISOString(), realizedEgp, pipelineEgp, lostEgp, byType };
  }

  /**
   * Close the failure side of the loop (PRD v1.2): projected recoveries whose P2P
   * listing expired unsold are marked terminal so pipeline never inflates forever.
   *   • deadstock_recovered → 'lost'  (dead capital not recovered)
   *   • expiry_avoided     → 'expired' (near-expiry stock that lapsed unsold)
   * stockout_avoided stays projected by design (protective, never "sold").
   * One global indexed UPDATE per type — safe at scale, idempotent (re-runs no-op).
   */
  async reconcileStaleProjections(): Promise<{ lost: number; expired: number }> {
    const lostRes = await this.dataSource.query(
      `UPDATE ai_recovery_events e SET status = 'lost'
         WHERE e.status = 'projected'
           AND e.type = 'deadstock_recovered'
           AND e.metadata->>'listingId' IN (SELECT id::text FROM p2p_listings WHERE status = 'expired')`,
    );
    const expiredRes = await this.dataSource.query(
      `UPDATE ai_recovery_events e SET status = 'expired'
         WHERE e.status = 'projected'
           AND e.type = 'expiry_avoided'
           AND e.metadata->>'listingId' IN (SELECT id::text FROM p2p_listings WHERE status = 'expired')`,
    );
    const lost = Array.isArray(lostRes) ? (lostRes[1] ?? 0) : 0;
    const expired = Array.isArray(expiredRes) ? (expiredRes[1] ?? 0) : 0;
    if (lost || expired) {
      this.logger.log(`recovery reconcile: ${lost} lost, ${expired} expired`);
    }
    return { lost, expired };
  }
}

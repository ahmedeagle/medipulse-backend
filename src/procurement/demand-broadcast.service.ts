import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { DrugNeedRequest } from './entities/drug-need-request.entity';
import { NotificationService } from '../notifications/notification.service';

const APP_NAME = 'Bnoov';
const MAX_TARGETS = 20;
// Only broadcast to stock-holders within this radius when coordinates exist.
const RADIUS_KM = 15;
// One broadcast per (holder, need) at most within this window — kills spam.
const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h

interface HolderRow {
  tenantId: string;
  whatsapp: string | null;
  qty: number;
}

export interface BroadcastResult {
  targeted: number;
  notified: number;
  whatsappQueued: number;
}

/**
 * DemandBroadcastService — the missing "create supply" half of "أحتاج دواء".
 *
 * When a pharmacy registers a NEED, the sourcing engine only reads EXISTING
 * supply (distributor catalogs + already-published P2P listings). A nearby
 * pharmacy that holds the drug but hasn't listed it never learns about the
 * demand. This service closes that loop: on need creation it finds nearby
 * pharmacies (same city) that hold the product in stock and proactively
 * notifies them so they can respond — turning latent stock into live supply.
 *
 * Urgency drives the channel (product decision):
 *   • normal   → no broadcast (watch-and-alert only)
 *   • urgent   → in-app notification to nearby stock-holders
 *   • critical → in-app + WhatsApp to nearby stock-holders
 *
 * Targeting is stock-aware (only pharmacies that actually have the item) so we
 * never spam the whole city. All cross-tenant reads happen server-side; an
 * individual pharmacy's need is never exposed to the requester.
 */
@Injectable()
export class DemandBroadcastService {
  private readonly logger = new Logger(DemandBroadcastService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  async broadcast(need: DrugNeedRequest): Promise<BroadcastResult> {
    const empty: BroadcastResult = { targeted: 0, notified: 0, whatsappQueued: 0 };

    // Product decision: 'normal' needs are watch-only — no outbound broadcast.
    if (need.urgency === 'normal') return empty;
    // Without a resolved product we cannot stock-match — skip (still watched by cron).
    if (!need.productId) return empty;

    let holders: HolderRow[];
    try {
      holders = await this.findNearbyHolders(need.productId, need.pharmacyTenantId);
    } catch (err) {
      this.logger.warn(`demand-broadcast holder query failed for need ${need.id}: ${(err as Error)?.message ?? err}`);
      return empty;
    }
    if (!holders.length) return empty;

    const urgencyTag = need.urgency === 'critical' ? '🚨 طارئ' : '⏱️ عاجل';
    let notified = 0;
    for (const h of holders) {
      try {
        await this.notifications.create({
          tenantId: h.tenantId,
          type: 'drug_need_broadcast',
          title: `${urgencyTag}: صيدلية قريبة تحتاج «${need.productName}»`,
          body:
            `صيدلية في نفس مدينتك تحتاج ${need.requestedQty} وحدة من «${need.productName}» ` +
            `ولديك مخزون منه. لو تقدر توفّره، اعرضه للبيع في «سوق التبادل» ليصل الطلب إليك فوراً.`,
          resourceRef: `needId=${need.id}`,
          dedupeWindowMs: DEDUPE_WINDOW_MS,
        });
        notified++;
      } catch (err) {
        this.logger.warn(`in-app broadcast to ${h.tenantId} failed: ${(err as Error)?.message ?? err}`);
      }
    }

    let whatsappQueued = 0;
    if (need.urgency === 'critical' && this.whatsappEnabled()) {
      for (const h of holders) {
        if (!h.whatsapp) continue;
        try {
          await this.queueWhatsapp(h, need);
          whatsappQueued++;
        } catch (err) {
          this.logger.warn(`WhatsApp broadcast to ${h.tenantId} failed: ${(err as Error)?.message ?? err}`);
        }
      }
    }

    this.logger.log(
      `demand-broadcast need=${need.id} urgency=${need.urgency} targeted=${holders.length} notified=${notified} whatsapp=${whatsappQueued}`,
    );
    return { targeted: holders.length, notified, whatsappQueued };
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  /**
   * Nearby verified+visible pharmacies that hold the product in stock.
   *
   * Proximity strategy (graceful degradation):
   *   • If the requester has coordinates → rank stock-holders by real Haversine
   *     distance and keep only those within RADIUS_KM (nearest first). Holders
   *     without coordinates in the same city are still included as a tail.
   *   • If the requester has no coordinates → fall back to same-city match.
   */
  private async findNearbyHolders(productId: string, requesterTenantId: string): Promise<HolderRow[]> {
    const rows: Array<{ tenantId: string; whatsapp: string | null; qty: string; distanceKm: string | null }> =
      await this.dataSource.query(
        `
        WITH me AS (
          SELECT city, latitude, longitude
          FROM seller_profiles
          WHERE "pharmacyTenantId" = $2
          LIMIT 1
        )
        SELECT
          inv."pharmacyTenantId" AS "tenantId",
          sp.whatsapp            AS whatsapp,
          inv.quantity           AS qty,
          CASE
            WHEN me.latitude IS NOT NULL AND me.longitude IS NOT NULL
             AND sp.latitude IS NOT NULL AND sp.longitude IS NOT NULL
            THEN 6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians(me.latitude)) * cos(radians(sp.latitude)) *
                cos(radians(sp.longitude) - radians(me.longitude)) +
                sin(radians(me.latitude)) * sin(radians(sp.latitude))
              ))
            )
            ELSE NULL
          END AS "distanceKm"
        FROM inventory_items inv
        INNER JOIN seller_profiles sp
          ON sp."pharmacyTenantId" = inv."pharmacyTenantId"
         AND sp."verificationStatus" = 'verified'
         AND sp."isVisible" = true
        CROSS JOIN me
        WHERE inv."productId" = $1
          AND inv.quantity > 0
          AND inv."deletedAt" IS NULL
          AND inv."pharmacyTenantId" != $2
          AND (
            -- within radius when both sides have coordinates …
            (me.latitude IS NOT NULL AND sp.latitude IS NOT NULL AND
              6371 * acos(
                LEAST(1, GREATEST(-1,
                  cos(radians(me.latitude)) * cos(radians(sp.latitude)) *
                  cos(radians(sp.longitude) - radians(me.longitude)) +
                  sin(radians(me.latitude)) * sin(radians(sp.latitude))
                ))
              ) <= ${RADIUS_KM})
            -- … otherwise same-city fallback
            OR (sp.city IS NOT NULL AND me.city IS NOT NULL AND sp.city = me.city)
          )
        ORDER BY "distanceKm" ASC NULLS LAST, inv.quantity DESC
        LIMIT ${MAX_TARGETS}
        `,
        [productId, requesterTenantId],
      );

    return rows.map((r) => ({
      tenantId: r.tenantId,
      whatsapp: r.whatsapp ?? null,
      qty: Number(r.qty),
    }));
  }

  private whatsappEnabled(): boolean {
    return (this.config.get<string>('WHATSAPP_ENABLED') ?? 'false').toLowerCase() === 'true';
  }

  /**
   * Queue an outbound WhatsApp row (BSP adapter flips queued→sent). Mirrors the
   * pattern in WhatsappService.sendApprovalCard — a raw insert keeps this service
   * free of a cross-module dependency, and the unique providerMessageId guarantees
   * one message per (need, holder) even under retries.
   */
  private async queueWhatsapp(h: HolderRow, need: DrugNeedRequest): Promise<void> {
    const text =
      `🚨 طلب طارئ عبر ${APP_NAME}: صيدلية قريبة تحتاج ${need.requestedQty} وحدة من «${need.productName}». ` +
      `لو متوفر لديك، افتح ${APP_NAME} واعرضه في سوق التبادل ليصلها طلبك.`;
    await this.dataSource.query(
      `
      INSERT INTO "whatsapp_messages"
        ("tenantId","direction","providerMessageId","phone","templateOrPreview","status","payload")
      VALUES ($1, 'outbound', $2, $3, $4, 'queued', $5::jsonb)
      ON CONFLICT ("providerMessageId") DO NOTHING
      `,
      [
        h.tenantId,
        `need:${need.id}:${h.tenantId}`,
        h.whatsapp,
        'drug_need_broadcast',
        JSON.stringify({ needId: need.id, productName: need.productName, qty: need.requestedQty, text }),
      ],
    );
  }
}

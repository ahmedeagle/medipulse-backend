import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ApprovalService } from '../ai-governance/approval.service';
import { NotificationService } from '../notifications/notification.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';

interface StaleOrderRow {
  id: string;
  status: string;
  buyerTenantId: string;
  sellerTenantId: string;
  requestedQty: number;
  agreedPrice: string;
  urgencyLevel: string;
  scenario: 'seller_no_response' | 'not_shipped' | 'receipt_pending' | 'expiry_warning';
  product_name: string;
  seller_name: string;
  buyer_name: string;
  hours_since_created: string;
  hours_since_accepted: string;
  hours_since_shipped: string;
}

@Injectable()
export class P2pOrderMonitorCron {
  private readonly logger = new Logger(P2pOrderMonitorCron.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: ApprovalService,
    private readonly notifications: NotificationService,
    private readonly settingsSvc: PharmacySettingsService,
  ) {}

  @Cron('*/15 * * * *')
  async detectStaleOrders(): Promise<void> {
    let rows: StaleOrderRow[] = [];
    try {
      rows = await this.dataSource.query<StaleOrderRow[]>(`
        SELECT
          o.id,
          o.status,
          o."buyerTenantId",
          o."sellerTenantId",
          o."requestedQty",
          o."agreedPrice",
          o."urgencyLevel",
          COALESCE(p."nameAr", p.name, '#' || LEFT(o."listingId"::text, 8)) AS product_name,
          COALESCE(t_s.name, o."sellerTenantId"::text)                      AS seller_name,
          COALESCE(t_b.name, o."buyerTenantId"::text)                       AS buyer_name,
          EXTRACT(EPOCH FROM (NOW() - o."createdAt"))   / 3600              AS hours_since_created,
          EXTRACT(EPOCH FROM (NOW() - o."respondedAt")) / 3600              AS hours_since_accepted,
          EXTRACT(EPOCH FROM (NOW() - o."shippedAt"))   / 3600              AS hours_since_shipped,
          CASE
            WHEN o.status = 'pending'
                 AND o."createdAt" < NOW() - INTERVAL '2 hours'
              THEN 'seller_no_response'
            WHEN o.status = 'accepted'
                 AND o."urgencyLevel" = 'normal'
                 AND o."respondedAt" < NOW() - INTERVAL '4 hours'
              THEN 'not_shipped'
            WHEN o.status = 'accepted'
                 AND o."urgencyLevel" IN ('urgent','critical')
                 AND o."respondedAt" < NOW() - INTERVAL '1 hour'
              THEN 'not_shipped'
            WHEN o.status = 'shipped'
                 AND o."shippedAt" < NOW() - INTERVAL '3 days'
              THEN 'receipt_pending'
            WHEN o.status = 'accepted'
                 AND o."reservationExpiresAt" IS NOT NULL
                 AND o."reservationExpiresAt" BETWEEN NOW() AND NOW() + INTERVAL '30 minutes'
              THEN 'expiry_warning'
          END AS scenario
        FROM p2p_orders o
        LEFT JOIN p2p_listings  l   ON l.id  = o."listingId"
        LEFT JOIN products      p   ON p.id  = l."productId"
        LEFT JOIN tenants        t_s ON t_s.id = o."sellerTenantId"
        LEFT JOIN tenants        t_b ON t_b.id = o."buyerTenantId"
        WHERE o.status IN ('pending', 'accepted', 'shipped')
          AND (
            (o.status = 'pending'
             AND o."createdAt" < NOW() - INTERVAL '2 hours')
            OR (o.status = 'accepted'
                AND o."urgencyLevel" = 'normal'
                AND o."respondedAt" < NOW() - INTERVAL '4 hours')
            OR (o.status = 'accepted'
                AND o."urgencyLevel" IN ('urgent','critical')
                AND o."respondedAt" < NOW() - INTERVAL '1 hour')
            OR (o.status = 'shipped'
                AND o."shippedAt" < NOW() - INTERVAL '3 days')
            OR (o.status = 'accepted'
                AND o."reservationExpiresAt" IS NOT NULL
                AND o."reservationExpiresAt" BETWEEN NOW() AND NOW() + INTERVAL '30 minutes')
          )
          -- de-dup: skip if a pending/modified approval already exists for this order
          AND NOT EXISTS (
            SELECT 1 FROM approvals a
            WHERE a."subjectType" = 'p2p_order_action'
              AND a."subjectId"   = o.id
              AND a.status IN ('pending', 'modified')
          )
        LIMIT 100
      `);
    } catch (err: any) {
      this.logger.error(`P2pOrderMonitorCron query failed: ${err.message}`);
      return;
    }

    if (!rows.length) return;
    this.logger.log(`P2pOrderMonitorCron: ${rows.length} stale order(s) detected`);

    for (const row of rows) {
      if (!row.scenario) continue;
      try {
        await this.createTaskForOrder(row);
      } catch (err: any) {
        this.logger.error(`Failed to create approval for order ${row.id}: ${err.message}`);
      }
    }
  }

  private async createTaskForOrder(row: StaleOrderRow): Promise<void> {
    const cfg = this.scenarioCfg(row);
    const payload = {
      orderId: row.id,
      action: cfg.action,
      scenario: row.scenario,
      orderSummary: {
        productName:      row.product_name,
        qty:              row.requestedQty,
        totalValue:       Number(row.agreedPrice) * row.requestedQty,
        counterpartyName: cfg.counterpartyName(row),
        sellerTenantId:   row.sellerTenantId,
        buyerTenantId:    row.buyerTenantId,
        hoursStuck:       Math.floor(Number(cfg.hoursStuck(row))),
      },
    };

    const approval = await this.approvals.create(cfg.tenantId(row), {
      agentCode:       'p2p_monitor',
      subjectType:     'p2p_order_action',
      subjectId:       row.id,
      title:           cfg.title(row),
      summary:         cfg.summary(row),
      rationale:       cfg.rationale(row),
      confidence:      cfg.confidence,
      priority:        cfg.priority,
      payload,
      expiresAt:       cfg.expiresAt(),
      confidenceReason: cfg.confidenceReason,
    });

    if (!approval) return; // agent disabled or below minConfidence for this tenant

    // Send in-app notification so the pharmacist sees the badge
    if (await this.settingsSvc.getNotifFlag(cfg.tenantId(row), 'enableP2POrderAlerts')) {
      await this.notifications.create({
        tenantId:    cfg.tenantId(row),
        type:        'p2p_order_action_required',
        title:       cfg.title(row),
        body:        cfg.summary(row),
        resourceRef: `p2p_order:${row.id}`,
      });
    }
  }

  private scenarioCfg(row: StaleOrderRow) {
    const hours = (n: string | number) => Math.floor(Number(n));
    const addMs  = (ms: number) => new Date(Date.now() + ms).toISOString();

    const cfgs = {
      seller_no_response: {
        tenantId:        (r: StaleOrderRow) => r.buyerTenantId,
        counterpartyName:(r: StaleOrderRow) => r.seller_name,
        hoursStuck:      (r: StaleOrderRow) => r.hours_since_created,
        action:          'cancel' as const,
        confidence:      0.75,
        priority:        'high'  as const,
        confidenceReason:'الطلب بدون رد منذ أكثر من ساعتين',
        title:           (r: StaleOrderRow) => `طلب بدون رد منذ ${hours(r.hours_since_created)} ساعة`,
        summary:         (r: StaleOrderRow) => `طلب شراء "${r.product_name}" (${r.requestedQty} وحدة) أُرسل لصيدلية "${r.seller_name}" منذ ${hours(r.hours_since_created)} ساعة ولم يتلقَّ أي رد.`,
        rationale:       (r: StaleOrderRow) => `مرّت ${hours(r.hours_since_created)} ساعة منذ إرسال الطلب دون رد من البائع. الإلغاء يحرر رصيدك ويتيح لك البحث عن بديل.`,
        expiresAt:       () => addMs(6 * 3600 * 1000),
      },
      not_shipped: {
        tenantId:        (r: StaleOrderRow) => r.sellerTenantId,
        counterpartyName:(r: StaleOrderRow) => r.buyer_name,
        hoursStuck:      (r: StaleOrderRow) => r.hours_since_accepted,
        action:          'remind_seller' as const,
        confidence:      0.70,
        priority:        'medium' as const,
        confidenceReason:'الطلب مقبول ولم يُشحن بعد الوقت المتوقع',
        title:           (r: StaleOrderRow) => `طلب مقبول ولم يُشحن منذ ${hours(r.hours_since_accepted)} ساعة`,
        summary:         (r: StaleOrderRow) => `قبلت طلب "${r.product_name}" من صيدلية "${r.buyer_name}" ولم تقم بالشحن منذ ${hours(r.hours_since_accepted)} ساعة.`,
        rationale:       (r: StaleOrderRow) => `المشتري ينتظر الشحن. إرسال تذكير داخلي لإتمام الشحن والحفاظ على تقييمك.`,
        expiresAt:       () => addMs(2 * 3600 * 1000),
      },
      receipt_pending: {
        tenantId:        (r: StaleOrderRow) => r.buyerTenantId,
        counterpartyName:(r: StaleOrderRow) => r.seller_name,
        hoursStuck:      (r: StaleOrderRow) => r.hours_since_shipped,
        action:          'complete' as const,
        confidence:      0.80,
        priority:        'high' as const,
        confidenceReason:'مرّت 3 أيام منذ الشحن دون تأكيد استلام',
        title:           (r: StaleOrderRow) => `طلب مشحون لم يُأكد استلامه منذ ${Math.floor(Number(r.hours_since_shipped) / 24)} يوم`,
        summary:         (r: StaleOrderRow) => `"${r.product_name}" شُحن من صيدلية "${r.seller_name}" منذ ${Math.floor(Number(r.hours_since_shipped) / 24)} يوم ولم يُأكد الاستلام.`,
        rationale:       (r: StaleOrderRow) => `إذا استلمت البضاعة، تأكيد الاستلام يُغلق الطلب ويُسجّل الكميات في مخزونك تلقائياً.`,
        expiresAt:       () => addMs(24 * 3600 * 1000),
      },
      expiry_warning: {
        tenantId:        (r: StaleOrderRow) => r.sellerTenantId,
        counterpartyName:(r: StaleOrderRow) => r.buyer_name,
        hoursStuck:      (r: StaleOrderRow) => r.hours_since_accepted,
        action:          'remind_seller' as const,
        confidence:      0.95,
        priority:        'critical' as const,
        confidenceReason:'الحجز ينتهي خلال 30 دقيقة',
        title:           (_r: StaleOrderRow) => `⚠️ الحجز ينتهي خلال 30 دقيقة — اشحن الآن`,
        summary:         (r: StaleOrderRow) => `الحجز على "${r.product_name}" لصيدلية "${r.buyer_name}" ينتهي قريباً. الشحن الآن يحافظ على الطلب.`,
        rationale:       (_r: StaleOrderRow) => `سينتهي وقت الحجز قريباً مما سيُلغي الطلب تلقائياً ويُعيد الكمية للمخزون.`,
        expiresAt:       () => addMs(30 * 60 * 1000),
      },
    };

    return cfgs[row.scenario];
  }
}

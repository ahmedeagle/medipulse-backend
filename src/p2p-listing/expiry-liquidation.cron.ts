import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { ApprovalService } from '../ai-governance/approval.service';
import { NotificationService } from '../notifications/notification.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';
import { EVENTS } from '../events/domain-events';

interface NearExpiryRow {
  id: string;
  pharmacyTenantId: string;
  productId: string;
  quantity: number;
  costPrice: string | null;
  sellingPrice: string | null;
  expiryDate: string;
  days_to_expiry: string;
  product_name: string;
  product_name_ar: string | null;
}

interface NearExpiryEvent {
  tenantId: string;
  inventoryItemId: string;
  productId: string;
  productNameAr: string;
  quantity: number;
  sellingPrice: string | null;
  costPrice: string | null;
  expiryDate: string;
  daysToExpiry: number;
}

@Injectable()
export class ExpiryLiquidationCron {
  private readonly logger = new Logger(ExpiryLiquidationCron.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: ApprovalService,
    private readonly notifications: NotificationService,
    private readonly settingsSvc: PharmacySettingsService,
  ) {}

  /** Runs daily at 8:30 AM UTC — after the expired-inventory cron (6:00 AM). */
  @Cron('30 8 * * *')
  async detectNearExpiryStock(): Promise<void> {
    let rows: NearExpiryRow[] = [];

    try {
      rows = await this.dataSource.query<NearExpiryRow[]>(`
        SELECT
          i.id,
          i."pharmacyTenantId",
          i."productId",
          i.quantity,
          i."costPrice",
          i."sellingPrice",
          i."expiryDate"::text                                                   AS "expiryDate",
          (i."expiryDate"::date - CURRENT_DATE)                                  AS days_to_expiry,
          COALESCE(p."nameAr", p.name, 'منتج غير مسمى')                          AS product_name_ar,
          COALESCE(p.name, p."nameAr", 'Unknown product')                        AS product_name
        FROM inventory_items i
        LEFT JOIN products p ON p.id = i."productId"
        WHERE i."deletedAt" IS NULL
          AND i.quantity > 0
          AND i."expiryDate" IS NOT NULL
          AND i."expiryDate"::date > CURRENT_DATE
          AND i."expiryDate"::date <= CURRENT_DATE + INTERVAL '90 days'
          -- Skip if an active listing already exists for this inventory item
          AND NOT EXISTS (
            SELECT 1 FROM p2p_listings pl
            WHERE pl."inventoryItemId" = i.id
              AND pl.status = 'active'
          )
          -- De-dup: skip if a pending/modified liquidation approval already exists
          AND NOT EXISTS (
            SELECT 1 FROM approvals a
            WHERE a."subjectType" = 'expiry_liquidation'
              AND a."subjectId"   = i.id
              AND a.status IN ('pending', 'modified')
          )
        ORDER BY i."expiryDate" ASC
        LIMIT 200
      `);
    } catch (err: any) {
      this.logger.error(`ExpiryLiquidationCron query failed: ${err.message}`);
      return;
    }

    if (!rows.length) {
      this.logger.debug('ExpiryLiquidationCron: no near-expiry unlisted items found');
      return;
    }

    this.logger.log(`ExpiryLiquidationCron: ${rows.length} near-expiry item(s) need attention`);

    for (const row of rows) {
      try {
        await this.createLiquidationTask(row);
      } catch (err: any) {
        this.logger.error(`Failed to create liquidation task for item ${row.id}: ${err.message}`);
      }
    }
  }

  /**
   * Fires immediately when an inventory item is created or updated with a
   * near-expiry date. Creates the AI Center task within seconds instead of
   * waiting for the 8:30 AM cron. The cron still runs daily as a catch-all.
   */
  @OnEvent(EVENTS.INVENTORY_NEAR_EXPIRY_DETECTED, { async: true })
  async onNearExpiryDetected(event: NearExpiryEvent): Promise<void> {
    this.logger.log(
      `ExpiryLiquidationCron: immediate trigger for item ${event.inventoryItemId} (${event.daysToExpiry}d)`,
    );
    const row: NearExpiryRow = {
      id:               event.inventoryItemId,
      pharmacyTenantId: event.tenantId,
      productId:        event.productId,
      quantity:         event.quantity,
      costPrice:        event.costPrice,
      sellingPrice:     event.sellingPrice,
      expiryDate:       event.expiryDate,
      days_to_expiry:   String(event.daysToExpiry),
      product_name:     event.productNameAr,
      product_name_ar:  event.productNameAr,
    };
    try {
      await this.createLiquidationTask(row);
    } catch (err: any) {
      this.logger.error(`ExpiryLiquidationCron onNearExpiryDetected failed: ${err.message}`);
    }
  }

  private async createLiquidationTask(row: NearExpiryRow): Promise<void> {
    const daysToExpiry = Number(row.days_to_expiry);
    const cfg = this.discountConfig(daysToExpiry);

    const costPrice    = Number(row.costPrice ?? 0);
    const sellingPrice = Number(row.sellingPrice ?? 0);
    const basePrice    = sellingPrice > 0 ? sellingPrice : costPrice > 0 ? costPrice * 1.15 : 0;
    const suggestedPrice =
      basePrice > 0
        ? parseFloat((basePrice * (1 - cfg.discountPct / 100)).toFixed(2))
        : 0;

    const priceKnown     = basePrice > 0;
    const riskValue      = parseFloat((basePrice * row.quantity).toFixed(2));
    const recoveredValue = parseFloat((suggestedPrice * row.quantity).toFixed(2));
    const productLabel   = row.product_name_ar ?? row.product_name;

    const approval = await this.approvals.create(row.pharmacyTenantId, {
      agentCode:        'expiry_liquidation',
      subjectType:      'expiry_liquidation',
      subjectId:        row.id,
      // Same liquidation need as dead_stock — collapse onto one card.
      needKey:          `liquidate::${row.productId}`,
      title:            `تصفية: ${productLabel} — ينتهي في ${daysToExpiry} يوم`,
      summary: priceKnown
        ? `${row.quantity} وحدة بسعر ${suggestedPrice} ج.م (خصم ${cfg.discountPct}%) — قيمة المخاطرة: ${riskValue} ج.م`
        : `${row.quantity} وحدة — سعر البيع غير محدد في المخزون. استخدم "تعديل" لتحديد السعر قبل الموافقة`,
      rationale: priceKnown
        ? `المنتج ينتهي في ${daysToExpiry} يوم وسيُشطب بالكامل بدون تدخل. البيع بخصم ${cfg.discountPct}% يسترد ${recoveredValue} ج.م من أصل ${riskValue} ج.م.`
        : `المنتج ينتهي في ${daysToExpiry} يوم وسيُشطب بالكامل بدون تدخل. سعر البيع غير مسجّل في بند المخزون — أدخل السعر يدوياً في حقل التعديل وسيُنفَّذ الإدراج فور موافقتك.`,
      confidence:       cfg.confidence,
      confidenceReason: cfg.confidenceReason,
      priority:         cfg.priority,
      payload: {
        inventoryItemId: row.id,
        productId:       row.productId,
        productName:     productLabel,
        quantity:        row.quantity,
        expiryDate:      row.expiryDate,
        daysToExpiry,
        discountPct:     cfg.discountPct,
        suggestedPrice,
        basePrice,
        listingType:     'clearance' as const,
      },
      expiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    });

    if (!approval) return; // agent disabled or confidence below tenant threshold

    if (await this.settingsSvc.getNotifFlag(row.pharmacyTenantId, 'enableClearanceAlerts')) {
      await this.notifications.create({
        tenantId:    row.pharmacyTenantId,
        type:        'near_expiry',
        title:       `تصفية مقترحة: ${productLabel}`,
        body:        `${row.quantity} وحدة تنتهي في ${daysToExpiry} يوم — راجع مهمة التصفية في مركز الذكاء`,
        resourceRef: `/pharmacy/ai-center?tab=tasks&task=expiry_clearance`,
      });
    }
  }

  private discountConfig(daysToExpiry: number): {
    discountPct: number;
    priority: 'critical' | 'high' | 'medium';
    confidence: number;
    confidenceReason: string;
  } {
    if (daysToExpiry <= 30) {
      return {
        discountPct:      25,
        priority:         'critical',
        confidence:       0.92,
        confidenceReason: `المنتج ينتهي خلال ${daysToExpiry} يوم — خطر شطب وشيك`,
      };
    }
    if (daysToExpiry <= 60) {
      return {
        discountPct:      15,
        priority:         'high',
        confidence:       0.85,
        confidenceReason: `المنتج ينتهي خلال ${daysToExpiry} يوم — نافذة مربحة للتصفية`,
      };
    }
    return {
      discountPct:      10,
      priority:         'medium',
      confidence:       0.75,
      confidenceReason: `المنتج ينتهي خلال ${daysToExpiry} يوم — خصم مبكر يضمن السيولة`,
    };
  }
}

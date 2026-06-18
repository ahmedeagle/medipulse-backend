import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { NotificationService } from '../notifications/notification.service';
import { EVENTS } from '../events/domain-events';

interface StockoutRow {
  pharmacyTenantId: string;
  product_name_ar: string;
  selling_price: string;
  avg_daily_units: string;
  days_at_zero: string;
  daily_lost_egp: string;
  total_lost_egp: string;
}

interface StockoutEvent {
  tenantId: string;
  inventoryItemId: string;
  productId: string;
  productNameAr: string;
  previousQuantity: number;
}

/**
 * Lost Revenue Insight Layer.
 *
 * Rule: KNOW something — not DO something.
 * This cron never creates approval tasks. It only sends insight notifications
 * so the owner/manager sees money lost from stockouts.
 *
 * The "DO something" part is handled by Low Stock (low-stock.cron.ts).
 */
@Injectable()
export class LostRevenueCron {
  private readonly logger = new Logger(LostRevenueCron.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Daily 8 AM — one digest notification per tenant showing total EGP lost
   * from all current stockouts with sales history.
   * Single cross-tenant query, one round-trip.
   */
  @Cron('0 8 * * *')
  async sendDailyLossDigest(): Promise<void> {
    let rows: StockoutRow[] = [];
    try {
      rows = await this.dataSource.query<StockoutRow[]>(`
        WITH demand AS (
          SELECT
            s."tenantId",
            s."productId",
            SUM(s."quantityConsumed")::float / 30.0 AS avg_daily_units
          FROM consumption_snapshots s
          WHERE s."weekStart" >= NOW() - INTERVAL '30 days'
          GROUP BY s."tenantId", s."productId"
          HAVING SUM(s."quantityConsumed") > 0
        )
        SELECT
          i."pharmacyTenantId",
          COALESCE(p."nameAr", p.name, 'منتج غير مسمى')                AS product_name_ar,
          COALESCE(i."sellingPrice"::numeric, 0)                        AS selling_price,
          d.avg_daily_units,
          GREATEST(1, EXTRACT(DAYS FROM NOW() - i."updatedAt"))::int    AS days_at_zero,
          ROUND((d.avg_daily_units * COALESCE(i."sellingPrice"::numeric, 0))::numeric, 2)
                                                                        AS daily_lost_egp,
          ROUND((
            d.avg_daily_units
            * COALESCE(i."sellingPrice"::numeric, 0)
            * GREATEST(1, EXTRACT(DAYS FROM NOW() - i."updatedAt"))
          )::numeric, 2)                                                AS total_lost_egp
        FROM inventory_items i
        JOIN demand d ON d."tenantId" = i."pharmacyTenantId"
                     AND d."productId" = i."productId"
        LEFT JOIN products p ON p.id = i."productId"
        WHERE i."deletedAt" IS NULL
          AND i.quantity = 0
          AND i."updatedAt" <= NOW() - INTERVAL '2 hours'
        ORDER BY i."pharmacyTenantId", (d.avg_daily_units * COALESCE(i."sellingPrice"::numeric, 0)) DESC
      `);
    } catch (err: any) {
      this.logger.error(`LostRevenueCron digest failed: ${err.message}`);
      return;
    }

    if (!rows.length) {
      this.logger.debug('LostRevenueCron: no active stockout losses');
      return;
    }

    // Group by tenant
    const byTenant = new Map<string, StockoutRow[]>();
    for (const row of rows) {
      const list = byTenant.get(row.pharmacyTenantId) ?? [];
      list.push(row);
      byTenant.set(row.pharmacyTenantId, list);
    }

    for (const [tenantId, items] of byTenant) {
      try {
        await this.sendDigestNotification(tenantId, items);
      } catch (err: any) {
        this.logger.error(`LostRevenueCron: digest failed for tenant ${tenantId}: ${err.message}`);
      }
    }
  }

  /**
   * Immediate insight when a product hits zero.
   * Tells the owner exactly what this stockout costs per day — no action needed
   * from here, the Low Stock task already handles "what to do".
   */
  @OnEvent(EVENTS.INVENTORY_STOCKOUT_DETECTED, { async: true })
  async onStockoutDetected(event: StockoutEvent): Promise<void> {
    const [row] = await this.dataSource.query<StockoutRow[]>(`
      SELECT
        i."pharmacyTenantId",
        COALESCE(p."nameAr", p.name, 'منتج غير مسمى')   AS product_name_ar,
        COALESCE(i."sellingPrice"::numeric, 0)            AS selling_price,
        COALESCE(d.avg_daily_units, 0)                    AS avg_daily_units,
        1                                                  AS days_at_zero,
        ROUND((COALESCE(d.avg_daily_units, 0) * COALESCE(i."sellingPrice"::numeric, 0))::numeric, 2)
                                                           AS daily_lost_egp,
        ROUND((COALESCE(d.avg_daily_units, 0) * COALESCE(i."sellingPrice"::numeric, 0))::numeric, 2)
                                                           AS total_lost_egp
      FROM inventory_items i
      LEFT JOIN products p ON p.id = i."productId"
      LEFT JOIN LATERAL (
        SELECT SUM(s."quantityConsumed")::float / 30.0 AS avg_daily_units
        FROM consumption_snapshots s
        WHERE s."tenantId"  = i."pharmacyTenantId"
          AND s."productId" = i."productId"
          AND s."weekStart" >= NOW() - INTERVAL '30 days'
      ) d ON true
      WHERE i.id = $1 AND i."deletedAt" IS NULL AND i.quantity = 0
    `, [event.inventoryItemId]);

    if (!row) return;

    const dailyLost = parseFloat(row.daily_lost_egp as any) || 0;
    if (dailyLost === 0) return; // No sales history — can't estimate

    const productName = row.product_name_ar;
    const dailyStr    = dailyLost.toFixed(0);

    try {
      await this.notifications.create({
        tenantId:    event.tenantId,
        type:        'low_stock',
        title:       `خسارة مبيعات: "${productName}" نفد تماماً`,
        body:        `بناءً على سجل المبيعات، ستخسر ~${dailyStr} ج.م كل يوم حتى تُعيد الطلب.\nمهمة نقص المخزون موجودة في مركز الذكاء.`,
        resourceRef: `/pharmacy/ai-center?tab=tasks&task=low_stock`,
      });
    } catch (err: any) {
      this.logger.error(`LostRevenueCron: immediate notification failed: ${err.message}`);
    }
  }

  private async sendDigestNotification(tenantId: string, items: StockoutRow[]): Promise<void> {
    const totalDaily = items.reduce((s, r) => s + (parseFloat(r.daily_lost_egp as any) || 0), 0);
    const totalAll   = items.reduce((s, r) => s + (parseFloat(r.total_lost_egp as any) || 0), 0);
    const topItems   = items.slice(0, 3).map(r => {
      const d = parseFloat(r.daily_lost_egp as any) || 0;
      return `${r.product_name_ar} (~${d.toFixed(0)} ج.م/يوم)`;
    });

    const body = [
      `إجمالي الخسارة المتراكمة: ~${totalAll.toFixed(0)} ج.م`,
      `الخسارة اليومية الحالية: ~${totalDaily.toFixed(0)} ج.م/يوم`,
      topItems.length ? `أكثر المنتجات خسارة:\n${topItems.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    await this.notifications.create({
      tenantId,
      type:        'low_stock',
      title:       `خسائر أمس: ~${totalAll.toFixed(0)} ج.م من ${items.length} منتج نافد`,
      body,
      resourceRef: `/pharmacy/ai-center?tab=tasks&task=low_stock`,
    });

    this.logger.log(
      `LostRevenueCron: digest sent to tenant ${tenantId} — ` +
      `${items.length} items, ~${totalAll.toFixed(0)} ج.م total loss`,
    );
  }
}

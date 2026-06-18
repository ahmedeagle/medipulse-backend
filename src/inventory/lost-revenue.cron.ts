import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { ApprovalService } from '../ai-governance/approval.service';
import { EVENTS } from '../events/domain-events';

interface LostRevenueRow {
  id: string;
  pharmacyTenantId: string;
  productId: string;
  selling_price: string;
  avg_daily_units: string;
  days_at_zero: string;
  total_lost_egp: string;
  product_name_ar: string;
  product_name: string;
}

interface StockoutEvent {
  tenantId: string;
  inventoryItemId: string;
  productId: string;
  productNameAr: string;
  previousQuantity: number;
}

@Injectable()
export class LostRevenueCron {
  private readonly logger = new Logger(LostRevenueCron.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: ApprovalService,
  ) {}

  /**
   * Daily 10 AM sweep — processes all tenants in one query using a window function
   * to cap at top-10 most-costly stockouts per tenant.
   * Efficient at scale: single round-trip, no per-tenant loop.
   */
  @Cron('0 10 * * *')
  async detectStockoutLosses(): Promise<void> {
    let rows: LostRevenueRow[] = [];
    try {
      rows = await this.dataSource.query<LostRevenueRow[]>(`
        WITH demand AS (
          SELECT
            s."tenantId",
            s."productId",
            SUM(s."quantityConsumed")::float / 30.0 AS avg_daily_units
          FROM consumption_snapshots s
          WHERE s."weekStart" >= NOW() - INTERVAL '30 days'
          GROUP BY s."tenantId", s."productId"
          HAVING SUM(s."quantityConsumed") > 0
        ),
        ranked AS (
          SELECT
            i.id,
            i."pharmacyTenantId",
            i."productId",
            COALESCE(i."sellingPrice"::numeric, 0)                                        AS selling_price,
            d.avg_daily_units,
            GREATEST(1, EXTRACT(DAYS FROM NOW() - i."updatedAt"))::int                   AS days_at_zero,
            ROUND((
              d.avg_daily_units
              * COALESCE(i."sellingPrice"::numeric, 0)
              * GREATEST(1, EXTRACT(DAYS FROM NOW() - i."updatedAt"))
            )::numeric, 2)                                                                AS total_lost_egp,
            COALESCE(p."nameAr", p.name, 'منتج غير مسمى')                                AS product_name_ar,
            COALESCE(p.name, p."nameAr", 'Unknown product')                              AS product_name,
            ROW_NUMBER() OVER (
              PARTITION BY i."pharmacyTenantId"
              ORDER BY (d.avg_daily_units * COALESCE(i."sellingPrice"::numeric, 0)) DESC
            ) AS rn
          FROM inventory_items i
          JOIN demand d ON d."tenantId" = i."pharmacyTenantId"
                       AND d."productId" = i."productId"
          LEFT JOIN products p ON p.id = i."productId"
          WHERE i."deletedAt" IS NULL
            AND i.quantity = 0
            -- Been at zero for at least 2 hours (avoids transient zero during a sale)
            AND i."updatedAt" <= NOW() - INTERVAL '2 hours'
            -- Per-item dedup: no active lost_revenue approval already exists
            AND NOT EXISTS (
              SELECT 1 FROM approvals a
              WHERE a."subjectType" = 'lost_revenue'
                AND a."subjectId"   = i.id
                AND a.status IN ('pending', 'modified')
            )
        )
        SELECT id, "pharmacyTenantId", "productId",
               selling_price, avg_daily_units, days_at_zero, total_lost_egp,
               product_name_ar, product_name
        FROM ranked
        WHERE rn <= 10
        ORDER BY "pharmacyTenantId", total_lost_egp DESC
      `);
    } catch (err: any) {
      this.logger.error(`LostRevenueCron sweep failed: ${err.message}`);
      return;
    }

    if (!rows.length) {
      this.logger.debug('LostRevenueCron: no stockout losses detected');
      return;
    }

    this.logger.log(`LostRevenueCron: ${rows.length} stockout items across all tenants`);
    for (const row of rows) {
      try {
        await this.createLostRevenueTask(row);
      } catch (err: any) {
        this.logger.error(`LostRevenueCron: failed for item ${row.id}: ${err.message}`);
      }
    }
  }

  /**
   * Fires immediately when inventory quantity is set to 0.
   * Lets the pharmacist see the loss in real-time during the day,
   * not just on the next morning cron run.
   */
  @OnEvent(EVENTS.INVENTORY_STOCKOUT_DETECTED, { async: true })
  async onStockoutDetected(event: StockoutEvent): Promise<void> {
    this.logger.log(
      `LostRevenueCron: immediate trigger — ${event.productNameAr} went to zero ` +
      `(was ${event.previousQuantity}, tenant ${event.tenantId})`,
    );

    // Fetch demand + price for this single item — lightweight single-item query
    const [row] = await this.dataSource.query<LostRevenueRow[]>(`
      SELECT
        i.id,
        i."pharmacyTenantId",
        i."productId",
        COALESCE(i."sellingPrice"::numeric, 0)             AS selling_price,
        COALESCE(d.avg_daily_units, 0)                     AS avg_daily_units,
        1                                                   AS days_at_zero,
        ROUND((COALESCE(d.avg_daily_units, 0) * COALESCE(i."sellingPrice"::numeric, 0))::numeric, 2) AS total_lost_egp,
        COALESCE(p."nameAr", p.name, 'منتج غير مسمى')     AS product_name_ar,
        COALESCE(p.name,    p."nameAr", 'Unknown product') AS product_name
      FROM inventory_items i
      LEFT JOIN products p ON p.id = i."productId"
      LEFT JOIN LATERAL (
        SELECT SUM(s."quantityConsumed")::float / 30.0 AS avg_daily_units
        FROM consumption_snapshots s
        WHERE s."tenantId"  = i."pharmacyTenantId"
          AND s."productId" = i."productId"
          AND s."weekStart" >= NOW() - INTERVAL '30 days'
      ) d ON true
      WHERE i.id = $1
        AND i."deletedAt" IS NULL
        AND i.quantity = 0
        -- Dedup: no active task already
        AND NOT EXISTS (
          SELECT 1 FROM approvals a
          WHERE a."subjectType" = 'lost_revenue'
            AND a."subjectId"   = i.id
            AND a.status IN ('pending', 'modified')
        )
    `, [event.inventoryItemId]);

    if (!row) return; // Already handled or no demand history

    const avgDailyUnits = parseFloat(row.avg_daily_units as any) || 0;
    if (avgDailyUnits === 0) return; // No sales history → can't estimate loss

    try {
      await this.createLostRevenueTask(row);
    } catch (err: any) {
      this.logger.error(`LostRevenueCron onStockoutDetected failed: ${err.message}`);
    }
  }

  private async createLostRevenueTask(row: LostRevenueRow): Promise<void> {
    const productLabel  = row.product_name_ar ?? row.product_name;
    const avgDailyUnits = parseFloat(row.avg_daily_units as any) || 0;
    const daysAtZero    = parseInt(row.days_at_zero   as any, 10) || 1;
    const totalLostEgp  = parseFloat(row.total_lost_egp  as any) || 0;
    const dailyLostEgp  = parseFloat(row.selling_price as any) * avgDailyUnits;
    const sellingPrice  = parseFloat(row.selling_price   as any) || 0;

    // Suggested reorder qty: 30-day demand, rounded up to nearest 5
    const suggestedQty = Math.ceil((avgDailyUnits * 30) / 5) * 5;

    const priority: 'critical' | 'high' | 'medium' =
      totalLostEgp >= 1000 ? 'critical' :
      totalLostEgp >= 300  ? 'high'     : 'medium';

    const lostStr  = totalLostEgp.toFixed(0);
    const dailyStr = dailyLostEgp.toFixed(0);

    const summary =
      `نفد المخزون منذ ${daysAtZero} ${daysAtZero === 1 ? 'يوم' : 'أيام'} — ` +
      `خسارة مقدّرة ~${lostStr} ج.م (${dailyStr} ج.م/يوم)`;

    const rationale =
      `"${productLabel}" يُباع بمعدل ${avgDailyUnits.toFixed(1)} وحدة/يوم وفقاً لسجل الـ 30 يوم الماضية. ` +
      `كل يوم إضافي بدون مخزون يعني خسارة ~${dailyStr} ج.م. ` +
      `عند الموافقة سيتحقق النظام من توفّره في البورصة الدوائية فوراً — وإن لم يُوجد سيُنشئ طلب شراء.`;

    await this.approvals.create(row.pharmacyTenantId, {
      agentCode:        'lost_revenue_detector',
      subjectType:      'lost_revenue',
      subjectId:        row.id,
      title:            `خسارة مبيعات: ${productLabel}`,
      summary,
      rationale,
      confidence:       0.90,
      confidenceReason: `متوسط مبيعات يومي ${avgDailyUnits.toFixed(1)} وحدة × سعر ${sellingPrice} ج.م × ${daysAtZero} يوم`,
      priority,
      payload: {
        inventoryItemId:    row.id,
        productId:          row.productId,
        productName:        productLabel,
        currentQuantity:    0,
        avgDailyUnits,
        daysAtZero,
        dailyLostEgp:       +dailyLostEgp.toFixed(2),
        estimatedTotalLoss: +totalLostEgp.toFixed(2),
        suggestedQty,
        sellingPrice,
      },
      expiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(), // 48 h — urgent
    });

    this.logger.log(
      `LostRevenueCron: created task for "${productLabel}" ` +
      `(~${lostStr} ج.م lost, tenant ${row.pharmacyTenantId})`,
    );
  }
}

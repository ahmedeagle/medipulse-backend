import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { ApprovalService } from '../ai-governance/approval.service';
import { EVENTS } from '../events/domain-events';

interface LowStockRow {
  id: string;
  pharmacyTenantId: string;
  productId: string;
  quantity: number;
  minThreshold: number;
  product_name_ar: string | null;
  product_name: string;
}

interface LowStockEvent {
  tenantId: string;
  inventoryItemId: string;
  productId: string;
  productNameAr: string;
  quantity: number;
  minThreshold: number;
}

@Injectable()
export class LowStockCron {
  private readonly logger = new Logger(LowStockCron.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: ApprovalService,
  ) {}

  /** Daily sweep at 9:15 AM UTC — catches any items already below threshold. */
  @Cron('15 9 * * *')
  async detectLowStock(): Promise<void> {
    let rows: LowStockRow[] = [];

    try {
      rows = await this.dataSource.query<LowStockRow[]>(`
        SELECT
          i.id,
          i."pharmacyTenantId",
          i."productId",
          i.quantity,
          i."minThreshold",
          COALESCE(p."nameAr", p.name, 'منتج غير مسمى') AS product_name_ar,
          COALESCE(p.name, p."nameAr", 'Unknown product')  AS product_name
        FROM inventory_items i
        LEFT JOIN products p ON p.id = i."productId"
        WHERE i."deletedAt" IS NULL
          AND i."minThreshold" > 0
          AND i.quantity >= 0
          AND i.quantity <= i."minThreshold"
          -- De-dup: skip if a pending/modified approval already exists
          AND NOT EXISTS (
            SELECT 1 FROM approvals a
            WHERE a."subjectType" = 'low_stock'
              AND a."subjectId"   = i.id
              AND a.status IN ('pending', 'modified')
          )
        ORDER BY i.quantity ASC
        LIMIT 300
      `);
    } catch (err: any) {
      this.logger.error(`LowStockCron query failed: ${err.message}`);
      return;
    }

    if (!rows.length) {
      this.logger.debug('LowStockCron: no below-threshold items found');
      return;
    }

    this.logger.log(`LowStockCron: ${rows.length} low-stock item(s) need attention`);

    for (const row of rows) {
      try {
        await this.createLowStockTask(row);
      } catch (err: any) {
        this.logger.error(`LowStockCron: failed to create task for item ${row.id}: ${err.message}`);
      }
    }
  }

  /**
   * Fires immediately when an inventory item quantity crosses below minThreshold.
   * Creates the AI Center task within seconds instead of waiting for 9:15 AM cron.
   */
  @OnEvent(EVENTS.INVENTORY_LOW_STOCK_DETECTED, { async: true })
  async onLowStockDetected(event: LowStockEvent): Promise<void> {
    this.logger.log(
      `LowStockCron: immediate trigger for item ${event.inventoryItemId} ` +
      `(qty ${event.quantity}/${event.minThreshold})`,
    );
    const row: LowStockRow = {
      id:               event.inventoryItemId,
      pharmacyTenantId: event.tenantId,
      productId:        event.productId,
      quantity:         event.quantity,
      minThreshold:     event.minThreshold,
      product_name:     event.productNameAr,
      product_name_ar:  event.productNameAr,
    };
    try {
      await this.createLowStockTask(row);
    } catch (err: any) {
      this.logger.error(`LowStockCron onLowStockDetected failed: ${err.message}`);
    }
  }

  private async createLowStockTask(row: LowStockRow): Promise<void> {
    const productLabel = row.product_name_ar ?? row.product_name;
    const deficit = Math.max(0, row.minThreshold - row.quantity);

    const priority: 'critical' | 'high' | 'medium' =
      row.quantity === 0                   ? 'critical' :
      row.quantity <= row.minThreshold / 2 ? 'high'     : 'medium';

    const confidence = row.quantity === 0 ? 0.95 : 0.88;

    const confidenceReason =
      row.quantity === 0
        ? 'المخزون نفد تماماً — لا يوجد احتمال مغاير للتوصية'
        : `المخزون (${row.quantity}) أقل من الحد الأدنى (${row.minThreshold}) — العجز ${deficit} وحدة`;

    const summary =
      row.quantity === 0
        ? `نفد المخزون تماماً — الحد الأدنى ${row.minThreshold} وحدة`
        : `المتوفر ${row.quantity} وحدة من أصل ${row.minThreshold} — عجز ${deficit} وحدة`;

    const rationale =
      `المخزون وصل للحد الأدنى. ` +
      `عند الموافقة سيتحقق النظام أولاً من توفّر هذا المنتج في البورصة الدوائية المحلية ` +
      `(نفس مدينتك) بسعر أفضل — وإن لم يتوفر، سيُحوَّلك إلى "مركز الذكاء → المهام" ` +
      `لمراجعة خطة الشراء الذكية من المورد الأنسب.`;

    await this.approvals.create(row.pharmacyTenantId, {
      agentCode:        'low_stock_replenishment',
      subjectType:      'low_stock',
      subjectId:        row.id,
      // Central orchestration: collapses with any other restock signal
      // (inventory_expert REORDER, smart_procurement p2p match, single
      // procurement_draft) for the same product into ONE task card.
      needKey:          `restock::${row.productId}`,
      title:            `نقص مخزون: ${productLabel}`,
      summary,
      rationale,
      confidence,
      confidenceReason,
      priority,
      payload: {
        inventoryItemId: row.id,
        productId:       row.productId,
        productName:     productLabel,
        quantity:        row.quantity,
        minThreshold:    row.minThreshold,
        deficit,
      },
      expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    });
  }
}

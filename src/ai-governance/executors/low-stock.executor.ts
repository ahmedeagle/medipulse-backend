import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';
import { NotificationService } from '../../notifications/notification.service';
import { RecoveryEventService } from '../../recovery/recovery-event.service';

/** Standard replenishment lead time (days) — matches the EOQ default. */
const STOCKOUT_LEAD_DAYS = 14;

interface LowStockPayload {
  inventoryItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  minThreshold: number;
  deficit: number;
}

interface ExecutionResult {
  action: 'p2p_available' | 'reorder';
  deepLink: string;
  listingId?: string;
  executedAt: string;
}

@Injectable()
export class LowStockExecutor {
  private readonly logger = new Logger(LowStockExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly notifications: NotificationService,
    private readonly dataSource: DataSource,
    private readonly recovery: RecoveryEventService,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'low_stock') return;

    const p = (approval.payload ?? {}) as LowStockPayload;
    this.logger.log(
      `LowStockExecutor: checking replenishment options for "${p.productName}" ` +
      `(qty ${p.quantity}/${p.minThreshold}, approval ${approval.id})`,
    );

    try {
      // Find the buyer's city from their seller profile (used for P2P geo-filter)
      const [buyerProfile] = await this.dataSource.query<{ city: string | null }[]>(
        `SELECT city FROM seller_profiles WHERE "pharmacyTenantId" = $1 LIMIT 1`,
        [approval.tenantId],
      );
      const buyerCity = buyerProfile?.city ?? null;

      let result: ExecutionResult;

      if (buyerCity) {
        // Check if any verified seller in the same city has this product active on P2P
        const [listing] = await this.dataSource.query<{ id: string }[]>(`
          SELECT pl.id
          FROM p2p_listings pl
          JOIN seller_profiles sp ON sp."pharmacyTenantId" = pl."sellerTenantId"
          WHERE pl."productId"  = $1
            AND pl.status       = 'active'
            AND pl.quantity     > 0
            AND sp.city         = $2
            AND sp."verificationStatus" = 'verified'
            AND pl."sellerTenantId" != $3
          LIMIT 1
        `, [p.productId, buyerCity, approval.tenantId]);

        if (listing) {
          result = {
            action:    'p2p_available',
            listingId: listing.id,
            deepLink:  `/pharmacy/p2p?tab=marketplace&productId=${p.productId}`,
            executedAt: new Date().toISOString(),
          };
        } else {
          // No same-city P2P — route to AI Center Tasks tab, where the
          // Purchase-Expert bridge will surface a procurement_draft approval
          // for this product (same needKey `restock::<productId>` so the
          // cards collapse). Avoids the legacy /pharmacy/procurement page.
          result = {
            action:    'reorder',
            deepLink:  `/pharmacy/ai-center?tab=tasks`,
            executedAt: new Date().toISOString(),
          };
        }
      } else {
        result = {
          action:    'reorder',
          deepLink:  `/pharmacy/ai-center?tab=tasks`,
          executedAt: new Date().toISOString(),
        };
      }

      await this.approvals.markExecuted(approval.tenantId, approval.id, result);

      const titleMap: Record<ExecutionResult['action'], string> = {
        p2p_available: `"${p.productName}" متاح للشراء من البورصة الدوائية`,
        reorder:       `"${p.productName}" — خطة الشراء جاهزة في مركز الذكاء`,
      };
      const bodyMap: Record<ExecutionResult['action'], string> = {
        p2p_available: `عُثر على عروض لـ ${p.productName} في نفس مدينتك. اضغط للاطلاع والشراء الآن.`,
        reorder:       `${p.productName} غير متاح في البورصة محلياً — راجع خطة الشراء الذكية في "مركز الذكاء → المهام".`,
      };

      await this.notifications.create({
        tenantId:    approval.tenantId,
        type:        'low_stock',
        title:       titleMap[result.action],
        body:        bodyMap[result.action],
        resourceRef: result.deepLink,
      });

      // Measurement layer: reordering before stockout protects the margin of the
      // sales that would have been lost during the replenishment lead window.
      // Projected (value protected, never captured as new cash) and ONLY recorded
      // when we have real consumption history + a real margin — no guessing.
      await this.recordStockoutAvoided(approval, p, result.action);

      this.logger.log(
        `LowStockExecutor: action=${result.action} for approval ${approval.id}`,
      );
    } catch (err: any) {
      this.logger.error(
        `LowStockExecutor: failed for approval ${approval.id} — ${err.message}`,
      );
      try {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          error:      err.message,
          failed:     true,
          executedAt: new Date().toISOString(),
        });
      } catch { /* state machine race */ }
    }
  }

  /**
   * Value protected by replenishing before a stockout = avoided lost margin over
   * the lead window. Uses real weekly consumption (consumption_snapshots) and the
   * item's real margin (sellingPrice − costPrice). Skips silently when either is
   * missing/zero, so the ledger never carries a guessed number.
   */
  private async recordStockoutAvoided(
    approval: Approval,
    p: LowStockPayload,
    action: ExecutionResult['action'],
  ): Promise<void> {
    try {
      const [row] = await this.dataSource.query<Array<{
        consumed: string | null; weeks: string | null;
        selling: string | null; cost: string | null;
      }>>(
        `SELECT
           (SELECT COALESCE(SUM(cs."quantityConsumed"), 0)
              FROM consumption_snapshots cs
             WHERE cs."tenantId" = $1 AND cs."productId" = $2
               AND cs."weekStart" >= (CURRENT_DATE - INTERVAL '56 days'))            AS consumed,
           (SELECT COUNT(DISTINCT cs."weekStart")
              FROM consumption_snapshots cs
             WHERE cs."tenantId" = $1 AND cs."productId" = $2
               AND cs."weekStart" >= (CURRENT_DATE - INTERVAL '56 days'))            AS weeks,
           ii."sellingPrice" AS selling,
           ii."costPrice"    AS cost
         FROM inventory_items ii
         WHERE ii.id = $3
         LIMIT 1`,
        [approval.tenantId, p.productId, p.inventoryItemId],
      );
      if (!row) return;

      const weeks = Number(row.weeks ?? 0);
      const consumed = Number(row.consumed ?? 0);
      const unitMargin = Math.max(Number(row.selling ?? 0) - Number(row.cost ?? 0), 0);
      if (weeks <= 0 || consumed <= 0 || unitMargin <= 0) return; // no real basis → skip

      const avgDailyUnits = consumed / (weeks * 7);
      const expectedValueEgp = Math.round(avgDailyUnits * STOCKOUT_LEAD_DAYS * unitMargin * 100) / 100;
      if (!(expectedValueEgp > 0)) return;

      await this.recovery.record({
        pharmacyTenantId: approval.tenantId,
        type:             'stockout_avoided',
        status:           'projected',
        expectedValueEgp,
        productId:        p.productId,
        sourceType:       'approval',
        sourceId:         approval.id,
        subjectType:      'low_stock',
        metadata: {
          action,
          avgDailyUnits: Math.round(avgDailyUnits * 100) / 100,
          leadDays: STOCKOUT_LEAD_DAYS,
          unitMargin: Math.round(unitMargin * 100) / 100,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `LowStockExecutor: stockout_avoided measurement skipped for ${approval.id} — ${err.message}`,
      );
    }
  }
}
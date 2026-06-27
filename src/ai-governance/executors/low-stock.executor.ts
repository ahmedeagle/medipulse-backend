import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';
import { NotificationService } from '../../notifications/notification.service';

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
}

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';
import { NotificationService } from '../../notifications/notification.service';
import { RecoveryEventService } from '../../recovery/recovery-event.service';

interface DeadStockPayload {
  inventoryItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  urgencyScore: number;
  deadStockProbability: number;
  recommendedAction: 'return_to_supplier' | 'markdown' | 'write_off' | 'monitor';
  suggestedDiscountPct: number;
  sellingPrice: number;
  costPrice: number;
}

@Injectable()
export class DeadStockExecutor {
  private readonly logger = new Logger(DeadStockExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly notifications: NotificationService,
    private readonly dataSource: DataSource,
    private readonly recovery: RecoveryEventService,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'dead_stock_clearance') return;

    const p = (approval.payload ?? {}) as DeadStockPayload;
    this.logger.log(
      `DeadStockExecutor: listing ${p.quantity} units of "${p.productName}" ` +
      `at ${p.suggestedDiscountPct}% discount (approval ${approval.id})`,
    );

    try {
      // Seller profile gate — same as expiry executor
      const [profile] = await this.dataSource.query<{ verificationStatus: string }[]>(
        `SELECT "verificationStatus" FROM seller_profiles WHERE "pharmacyTenantId" = $1 LIMIT 1`,
        [approval.tenantId],
      );
      if (!profile || profile.verificationStatus !== 'verified') {
        const statusMsg = !profile ? 'لم يتم إنشاء ملف البائع بعد' : `حالة الملف: ${profile.verificationStatus}`;
        this.logger.warn(
          `DeadStockExecutor: seller not verified for tenant ${approval.tenantId} — ${statusMsg}`,
        );
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          blocked:      true,
          reason:       'seller_not_verified',
          sellerStatus: profile?.verificationStatus ?? 'no_profile',
          executedAt:   new Date().toISOString(),
        });
        await this.notifications.create({
          tenantId:    approval.tenantId,
          type:        'dead_stock',
          title:       `تعذّر إدراج "${p.productName}" — ملف البائع غير مكتمل`,
          body:        `${statusMsg}. أكمل ملف صيدليتك في سوق التبادل حتى يتمكن مركز الذكاء من إدراج المنتجات تلقائياً.`,
          resourceRef: '/pharmacy/p2p?tab=profile',
        });
        return;
      }

      const listingRepo = this.dataSource.getRepository('p2p_listings');

      // Duplicate guard
      const existing = await listingRepo.findOne({
        where: { inventoryItemId: p.inventoryItemId, status: 'active' },
      });
      if (existing) {
        this.logger.warn(
          `DeadStockExecutor: active listing already exists for item ${p.inventoryItemId} — skipping`,
        );
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          skipped:    true,
          listingId:  (existing as any).id,
          reason:     'duplicate',
          executedAt: new Date().toISOString(),
        });
        return;
      }

      const sellingPrice = p.sellingPrice > 0
        ? p.sellingPrice * (1 - p.suggestedDiscountPct / 100)
        : p.costPrice    * (1 - p.suggestedDiscountPct / 100);

      const listing = listingRepo.create({
        sellerTenantId:     approval.tenantId,
        inventoryItemId:    p.inventoryItemId,
        productId:          p.productId,
        price:              sellingPrice,
        quantity:           p.quantity,
        minOrderQty:        1,
        listingType:        'clearance',
        offerType:          'discount',
        discountPct:        p.suggestedDiscountPct,
        autoUpdateDiscount: false,  // dead stock has no expiry deadline — no auto-deepening
        status:             'active',
      });
      const saved = await listingRepo.save(listing) as any;

      this.logger.log(
        `DeadStockExecutor: created P2P listing ${saved.id} for item ${p.inventoryItemId}`,
      );

      await this.notifyPotentialBuyers(approval.tenantId, saved.id, p);

      // Measurement layer: dead capital now being recovered. Projected until sold.
      await this.recovery.record({
        pharmacyTenantId: approval.tenantId,
        type:             'deadstock_recovered',
        status:           'projected',
        expectedValueEgp: Number(sellingPrice) * Number(p.quantity),
        productId:        p.productId,
        sourceType:       'approval',
        sourceId:         approval.id,
        subjectType:      'dead_stock_clearance',
        metadata:         { listingId: saved.id, discountPct: p.suggestedDiscountPct, quantity: p.quantity },
      });

      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        listingId:   saved.id,
        price:       sellingPrice,
        discountPct: p.suggestedDiscountPct,
        executedAt:  new Date().toISOString(),
      });

      // Seller confirmation — keep the user informed the item is now live, with a deep link.
      await this.notifications.create({
        tenantId:    approval.tenantId,
        type:        'p2p_listing_created',
        title:       `✓ تم إدراج "${p.productName}" للبيع في سوق التبادل`,
        body:        `تم نشر ${p.quantity} وحدة بخصم ${p.suggestedDiscountPct}%، ووصل إشعار للصيدليات القريبة المهتمة. تابع عرضك من صفحة السوق.`,
        resourceRef: '/pharmacy/p2p?tab=sell',
      });
    } catch (err: any) {
      this.logger.error(
        `DeadStockExecutor: failed for approval ${approval.id} — ${err.message}`,
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

  private async notifyPotentialBuyers(
    sellerTenantId: string,
    listingId: string,
    p: DeadStockPayload,
  ): Promise<void> {
    try {
      const buyers = await this.dataSource.query<{ tenantId: string }[]>(`
        SELECT DISTINCT t.id AS "tenantId"
        FROM tenants t
        JOIN seller_profiles sp_seller ON sp_seller."pharmacyTenantId" = $1
        JOIN seller_profiles sp_buyer  ON sp_buyer."pharmacyTenantId" = t.id
          AND sp_buyer.city = sp_seller.city
          AND sp_buyer."verificationStatus" = 'verified'
        WHERE t.id != $1
          AND (
            EXISTS (
              SELECT 1 FROM p2p_orders po
              JOIN p2p_listings pl ON pl.id = po."listingId"
              WHERE po."buyerTenantId" = t.id
                AND pl."productId" = $2
                AND po.status IN ('completed', 'shipped')
            )
            OR
            EXISTS (
              SELECT 1 FROM inventory_items ii
              WHERE ii."pharmacyTenantId" = t.id
                AND ii."productId" = $2
                AND ii."deletedAt" IS NULL
                AND ii.quantity <= ii."minThreshold"
            )
          )
        LIMIT 20
      `, [sellerTenantId, p.productId]);

      for (const buyer of buyers) {
        await this.notifications.create({
          tenantId:    buyer.tenantId,
          type:        'clearance_listing_available',
          title:       `عرض تصفية: ${p.productName} بخصم ${p.suggestedDiscountPct}%`,
          body:        `${p.productName} متاح بخصم ${p.suggestedDiscountPct}% — كميات محدودة`,
          resourceRef: `/pharmacy/p2p?tab=marketplace&filter=clearance`,
        });
      }

      if (buyers.length > 0) {
        this.logger.log(
          `DeadStockExecutor: notified ${buyers.length} potential buyer(s) about listing ${listingId}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`DeadStockExecutor: buyer notification failed — ${err.message}`);
    }
  }
}

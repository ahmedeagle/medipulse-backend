import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';
import { NotificationService } from '../../notifications/notification.service';
import { RecoveryEventService } from '../../recovery/recovery-event.service';

interface ExpiryLiquidationPayload {
  inventoryItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  expiryDate: string;
  daysToExpiry: number;
  discountPct: number;
  suggestedPrice: number;
  listingType: 'clearance';
}

@Injectable()
export class ExpiryLiquidationExecutor {
  private readonly logger = new Logger(ExpiryLiquidationExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly notifications: NotificationService,
    private readonly dataSource: DataSource,
    private readonly recovery: RecoveryEventService,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'expiry_liquidation') return;

    const p = (approval.payload ?? {}) as ExpiryLiquidationPayload;
    this.logger.log(
      `ExpiryLiquidationExecutor: listing ${p.quantity} units of "${p.productName}" ` +
      `at ${p.discountPct}% discount (approval ${approval.id})`,
    );

    try {
      // Seller profile gate — listings from unverified sellers are filtered out by all
      // marketplace queries (inner-join on verificationStatus='verified'), so creating
      // the listing would silently succeed but never surface to buyers.
      const [profile] = await this.dataSource.query<{ verificationStatus: string }[]>(
        `SELECT "verificationStatus" FROM seller_profiles WHERE "pharmacyTenantId" = $1 LIMIT 1`,
        [approval.tenantId],
      );
      if (!profile || profile.verificationStatus !== 'verified') {
        const statusMsg = !profile ? 'لم يتم إنشاء ملف البائع بعد' : `حالة الملف: ${profile.verificationStatus}`;
        this.logger.warn(
          `ExpiryLiquidationExecutor: seller not verified for tenant ${approval.tenantId} — ${statusMsg}`,
        );
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          blocked:      true,
          reason:       'seller_not_verified',
          sellerStatus: profile?.verificationStatus ?? 'no_profile',
          executedAt:   new Date().toISOString(),
        });
        await this.notifications.create({
          tenantId:    approval.tenantId,
          type:        'near_expiry',
          title:       `تعذّر إدراج "${p.productName}" — ملف البائع غير مكتمل`,
          body:        `${statusMsg}. أكمل ملف صيدليتك في سوق التبادل حتى يتمكن مركز الذكاء من إدراج المنتجات تلقائياً.`,
          resourceRef: '/pharmacy/p2p?tab=profile',
        });
        return;
      }

      const listingRepo = this.dataSource.getRepository('p2p_listings');

      // Duplicate guard — executor could fire more than once in edge cases
      const existing = await listingRepo.findOne({
        where: { inventoryItemId: p.inventoryItemId, status: 'active' },
      });
      if (existing) {
        this.logger.warn(
          `ExpiryLiquidationExecutor: active listing already exists for item ${p.inventoryItemId} — skipping`,
        );
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          skipped:   true,
          listingId: (existing as any).id,
          reason:    'duplicate',
          executedAt: new Date().toISOString(),
        });
        return;
      }

      const listing = listingRepo.create({
        sellerTenantId:     approval.tenantId,
        inventoryItemId:    p.inventoryItemId,
        productId:          p.productId,
        price:              p.suggestedPrice,
        quantity:           p.quantity,
        minOrderQty:        1,
        expiryDate:         new Date(p.expiryDate),
        listingType:        'clearance',
        offerType:          'discount',
        discountPct:        p.discountPct,
        autoUpdateDiscount: true,  // daily cron deepens discount as expiry closes in
        status:             'active',
      });
      const saved = await listingRepo.save(listing) as any;

      this.logger.log(
        `ExpiryLiquidationExecutor: created P2P listing ${saved.id} for item ${p.inventoryItemId}`,
      );

      // Notify potential buyer pharmacies in the same city
      await this.notifyPotentialBuyers(approval.tenantId, saved.id, p);

      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        listingId:   saved.id,
        price:       p.suggestedPrice,
        discountPct: p.discountPct,
        executedAt:  new Date().toISOString(),
      });

      // Seller confirmation — keep the user informed the item is now live, with a deep link.
      await this.notifications.create({
        tenantId:    approval.tenantId,
        type:        'p2p_listing_created',
        title:       `✓ تم إدراج "${p.productName}" للبيع في سوق التبادل`,
        body:        `تم نشر ${p.quantity} وحدة بخصم ${p.discountPct}% قبل انتهاء الصلاحية، ووصل إشعار للصيدليات القريبة المهتمة. تابع عرضك من صفحة السوق.`,
        resourceRef: '/pharmacy/p2p?tab=sell',
      });

      // Measurement layer: near-expiry stock now being recovered. Projected until
      // the P2P listing actually sells (realized on order completion, future wiring).
      await this.recovery.record({
        pharmacyTenantId: approval.tenantId,
        type:             'expiry_avoided',
        status:           'projected',
        expectedValueEgp: Number(p.suggestedPrice) * Number(p.quantity),
        productId:        p.productId,
        sourceType:       'approval',
        sourceId:         approval.id,
        subjectType:      'expiry_liquidation',
        metadata:         { listingId: saved.id, discountPct: p.discountPct, quantity: p.quantity },
      });
    } catch (err: any) {
      this.logger.error(
        `ExpiryLiquidationExecutor: failed for approval ${approval.id} — ${err.message}`,
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
   * Notify buyer pharmacies in the same city that have previously ordered
   * this product OR currently carry low stock of it.
   * Cap at 20 notifications per listing to avoid spam.
   */
  private async notifyPotentialBuyers(
    sellerTenantId: string,
    listingId: string,
    p: ExpiryLiquidationPayload,
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
            -- Buyer has ordered this product before via P2P
            EXISTS (
              SELECT 1 FROM p2p_orders po
              JOIN p2p_listings pl ON pl.id = po."listingId"
              WHERE po."buyerTenantId" = t.id
                AND pl."productId" = $2
                AND po.status IN ('completed', 'shipped')
            )
            OR
            -- Buyer carries this product with low stock
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
          title:       `عرض تصفية: ${p.productName} بخصم ${p.discountPct}%`,
          body:        `${p.productName} متاح بخصم ${p.discountPct}% — ينتهي في ${p.daysToExpiry} يوم، كميات محدودة`,
          resourceRef: `/pharmacy/p2p?tab=marketplace&filter=clearance`,
        });
      }

      if (buyers.length > 0) {
        this.logger.log(
          `ExpiryLiquidationExecutor: notified ${buyers.length} potential buyer(s) about listing ${listingId}`,
        );
      }
    } catch (err: any) {
      // Non-fatal — listing is already created, notifications are best-effort
      this.logger.warn(`ExpiryLiquidationExecutor: buyer notification failed — ${err.message}`);
    }
  }
}

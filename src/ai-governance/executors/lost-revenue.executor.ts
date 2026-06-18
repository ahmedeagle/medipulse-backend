import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';
import { NotificationService } from '../../notifications/notification.service';

interface LostRevenuePayload {
  inventoryItemId: string;
  productId: string;
  productName: string;
  currentQuantity: number;
  avgDailyUnits: number;
  daysAtZero: number;
  dailyLostEgp: number;
  estimatedTotalLoss: number;
  suggestedQty: number;
  sellingPrice: number;
}

@Injectable()
export class LostRevenueExecutor {
  private readonly logger = new Logger(LostRevenueExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly notifications: NotificationService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'lost_revenue') return;

    const p = (approval.payload ?? {}) as LostRevenuePayload;
    this.logger.log(
      `LostRevenueExecutor: handling stockout for "${p.productName}" ` +
      `(~${p.estimatedTotalLoss} ج.م lost, approval ${approval.id})`,
    );

    try {
      // Step 1: P2P — find verified sellers in same city
      const [p2pListing] = await this.dataSource.query<{ id: string; price: string; sellerTenantId: string }[]>(`
        SELECT pl.id, pl.price::text, pl."sellerTenantId"
        FROM p2p_listings pl
        JOIN seller_profiles sp_seller ON sp_seller."pharmacyTenantId" = pl."sellerTenantId"
          AND sp_seller."verificationStatus" = 'verified'
        JOIN seller_profiles sp_buyer ON sp_buyer."pharmacyTenantId" = $2
          AND sp_buyer.city = sp_seller.city
        WHERE pl."productId"     = $1
          AND pl.status          = 'active'
          AND pl.quantity        >= $3
          AND pl."sellerTenantId" != $2
        ORDER BY pl.price ASC
        LIMIT 1
      `, [p.productId, approval.tenantId, Math.min(p.suggestedQty, 1)]);

      if (p2pListing) {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          action:    'p2p_available',
          listingId: p2pListing.id,
          deepLink:  `/pharmacy/p2p?tab=marketplace&productId=${p.productId}&highlight=${p2pListing.id}`,
          executedAt: new Date().toISOString(),
        });

        await this.notifications.create({
          tenantId:    approval.tenantId,
          type:        'low_stock',
          title:       `"${p.productName}" متاح الآن في البورصة — أوقف الخسارة فوراً`,
          body:        `تخسر ~${p.dailyLostEgp} ج.م/يوم. عُثر على عروض في مدينتك. اشترِ الآن.`,
          resourceRef: `/pharmacy/p2p?tab=marketplace&productId=${p.productId}&highlight=${p2pListing.id}`,
        });

        this.logger.log(
          `LostRevenueExecutor: P2P listing ${p2pListing.id} found — ` +
          `directed to marketplace for "${p.productName}"`,
        );
        return;
      }

      // Step 2: Supplier catalog — cheapest available
      const [catalog] = await this.dataSource.query<{ id: string; supplierTenantId: string; price: string }[]>(`
        SELECT id, "supplierTenantId", price::text
        FROM supplier_catalog_items
        WHERE "productId"   = $1
          AND "isAvailable" = true
        ORDER BY price ASC
        LIMIT 1
      `, [p.productId]);

      if (catalog) {
        const draftRepo = this.dataSource.getRepository('procurement_drafts');
        const draft = draftRepo.create({
          pharmacyTenantId:  approval.tenantId,
          supplierTenantId:  catalog.supplierTenantId,
          productId:         p.productId,
          suggestedQuantity: p.suggestedQty,
          unitPrice:         parseFloat(catalog.price) || 0,
          currency:          'EGP',
          urgencyLevel:      'critical',
          status:            'pending_review',
          expiresAt:         new Date(Date.now() + 48 * 3600 * 1000),
        });
        const saved = await draftRepo.save(draft) as any;

        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          action:    'procurement_draft',
          draftId:   saved.id,
          deepLink:  '/pharmacy/procurement',
          executedAt: new Date().toISOString(),
        });

        await this.notifications.create({
          tenantId:    approval.tenantId,
          type:        'low_stock',
          title:       `تم إنشاء طلب شراء طارئ — ${p.productName}`,
          body:        `مسودة طلب شراء بكمية ${p.suggestedQty} وحدة جاهزة للمراجعة والإرسال للمورد.`,
          resourceRef: '/pharmacy/procurement',
        });

        this.logger.log(
          `LostRevenueExecutor: procurement draft ${saved.id} created for "${p.productName}"`,
        );
        return;
      }

      // Step 3: Nothing found — inform clearly
      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        action:    'no_source',
        warning:   'لم يُعثر على مصدر متاح في البورصة أو كتالوج الموردين',
        executedAt: new Date().toISOString(),
      });

      await this.notifications.create({
        tenantId:    approval.tenantId,
        type:        'low_stock',
        title:       `"${p.productName}" — لا مصدر متاح حالياً`,
        body:        `تم البحث في البورصة وكتالوج الموردين ولم يُعثر على ${p.productName}. أضفه لكتالوج مورد ثم ستظهر مهمة جديدة تلقائياً.`,
        resourceRef: '/pharmacy/catalog',
      });
    } catch (err: any) {
      this.logger.error(
        `LostRevenueExecutor: failed for approval ${approval.id} — ${err.message}`,
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

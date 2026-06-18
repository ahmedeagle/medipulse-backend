import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from './notification.service';
import { NotificationEmailService } from './notification-email.service';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import {
  RecommendationGeneratedEvent,
  OrderStatusChangedEvent,
  OrderDeliveredEvent,
  AiGovernanceBlockedEvent,
  EVENTS,
  P2P_EVENTS,
} from '../events/domain-events';
import { Role } from '../common/enums/role.enum';
import { SellerProfile } from '../p2p-seller/entities/seller-profile.entity';

/**
 * Listens to domain events and dispatches in-app + email notifications.
 *
 * Design principles:
 *   - Fire-and-forget: errors are logged, never propagate to the emitter
 *   - Email is opt-in by nature — only sent when user's email is known
 *   - Tenant-scoped: each notification is scoped to a tenant
 */
@Injectable()
export class NotificationEventListener {
  private readonly logger = new Logger(NotificationEventListener.name);

  /**
   * Per-tenant throttle for AI governance alerts. We only emit one
   * notification per (tenantId, blockType) per hour to avoid flooding
   * admins when a misbehaving prompt loops.
   */
  private readonly aiBlockedThrottle = new Map<string, number>();
  private static readonly AI_BLOCKED_THROTTLE_MS = 60 * 60 * 1000;

  constructor(
    private readonly notificationSvc: NotificationService,
    private readonly emailSvc: NotificationEmailService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(SellerProfile)
    private readonly sellerProfileRepo: Repository<SellerProfile>,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async sellerPrefs(tenantId: string) {
    const p = await this.sellerProfileRepo.findOne({
      where: { pharmacyTenantId: tenantId },
      select: ['notificationPrefs'],
    });
    return p?.notificationPrefs ?? {};
  }

  // ── P2P: buyer places order → notify SELLER (if newOrders pref enabled) ───

  @OnEvent(P2P_EVENTS.ORDER_CREATED)
  async onP2pOrderCreated(event: { sellerTenantId: string; buyerTenantId: string; orderId: string }): Promise<void> {
    try {
      const prefs = await this.sellerPrefs(event.sellerTenantId);
      if (prefs.newOrders === false) return;
      await this.notificationSvc.create({
        tenantId:    event.sellerTenantId,
        type:        'p2p_order_received',
        title:       'طلب شراء جديد',
        body:        'صيدلية أخرى طلبت أحد منتجاتك — راجع الطلب وقبله أو ارفضه.',
        resourceRef: `p2p_order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`P2P notification failed (order created): ${err.message}`);
    }
  }

  // ── P2P: seller accepts → notify BUYER (if orderActivity pref enabled) ────

  @OnEvent(P2P_EVENTS.ORDER_ACCEPTED)
  async onP2pOrderAccepted(event: { sellerTenantId: string; buyerTenantId: string; orderId: string }): Promise<void> {
    try {
      const prefs = await this.sellerPrefs(event.buyerTenantId);
      if (prefs.orderActivity === false) return;
      await this.notificationSvc.create({
        tenantId:    event.buyerTenantId,
        type:        'p2p_order_accepted',
        title:       'تم قبول طلبك ✓',
        body:        'قبل البائع طلبك. تواصل معه لترتيب الاستلام.',
        resourceRef: `p2p_order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`P2P notification failed (order accepted): ${err.message}`);
    }
  }

  // ── P2P: seller rejects → notify BUYER ────────────────────────────────────

  @OnEvent(P2P_EVENTS.ORDER_REJECTED)
  async onP2pOrderRejected(event: { sellerTenantId: string; buyerTenantId: string; orderId: string; reason?: string }): Promise<void> {
    try {
      const prefs = await this.sellerPrefs(event.buyerTenantId);
      if (prefs.orderActivity === false) return;
      await this.notificationSvc.create({
        tenantId:    event.buyerTenantId,
        type:        'p2p_order_rejected',
        title:       'تم رفض طلبك',
        body:        event.reason ? `رُفض طلبك: ${event.reason}` : 'رُفض طلبك من قِبَل البائع.',
        resourceRef: `p2p_order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`P2P notification failed (order rejected): ${err.message}`);
    }
  }

  // ── P2P: order cancelled → notify the OTHER party ────────────────────────

  @OnEvent(P2P_EVENTS.ORDER_CANCELLED)
  async onP2pOrderCancelled(event: {
    orderId: string;
    buyerTenantId: string;
    sellerTenantId: string;
    cancelledByTenantId: string;
  }): Promise<void> {
    try {
      const cancelledByBuyer = event.cancelledByTenantId === event.buyerTenantId;
      const notifyTenantId   = cancelledByBuyer ? event.sellerTenantId : event.buyerTenantId;

      const prefs = await this.sellerPrefs(notifyTenantId);
      if (prefs.orderActivity === false) return;

      const title = cancelledByBuyer
        ? 'تم إلغاء الطلب من قِبَل المشتري'
        : 'تم إلغاء الطلب من قِبَل البائع';
      const body = cancelledByBuyer
        ? 'ألغى المشتري طلب الشراء. الكمية أُعيدت لإعلانك تلقائياً إن كانت الصفقة مقبولة.'
        : 'ألغى البائع الطلب. يمكنك البحث عن بديل في سوق الأدوية.';

      await this.notificationSvc.create({
        tenantId:    notifyTenantId,
        type:        'p2p_order_cancelled',
        title,
        body,
        resourceRef: `p2p_order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`P2P notification failed (order cancelled): ${err.message}`);
    }
  }

  // ── P2P: seller ships → notify BUYER ─────────────────────────────────────

  @OnEvent(P2P_EVENTS.ORDER_SHIPPED)
  async onP2pOrderShipped(event: {
    orderId: string;
    buyerTenantId: string;
    sellerTenantId: string;
    deliveryNote?: string;
  }): Promise<void> {
    try {
      const prefs = await this.sellerPrefs(event.buyerTenantId);
      if (prefs.orderActivity === false) return;

      const body = event.deliveryNote
        ? `البائع أرسل طلبك في الطريق إليك. ملاحظة التوصيل: ${event.deliveryNote}`
        : 'البائع أرسل طلبك — يُتوقع وصوله قريباً. أكّد الاستلام عند الوصول.';

      await this.notificationSvc.create({
        tenantId:    event.buyerTenantId,
        type:        'p2p_order_shipped',
        title:       'تم شحن طلبك 📦',
        body,
        resourceRef: `p2p_order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`P2P notification failed (order shipped): ${err.message}`);
    }
  }

  // ── P2P: buyer confirms receipt → notify SELLER ───────────────────────────

  @OnEvent(P2P_EVENTS.ORDER_COMPLETED)
  async onP2pOrderCompleted(event: { sellerTenantId: string; buyerTenantId: string; orderId: string }): Promise<void> {
    try {
      const prefs = await this.sellerPrefs(event.sellerTenantId);
      if (prefs.orderActivity === false) return;
      await this.notificationSvc.create({
        tenantId:    event.sellerTenantId,
        type:        'p2p_order_completed',
        title:       'تم إتمام الطلب ✓',
        body:        'أكّد المشتري استلام الطلب. تم تسوية المبلغ.',
        resourceRef: `p2p_order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`P2P notification failed (order completed): ${err.message}`);
    }
  }

  // ── P2P: invoice generated → notify BUYER ────────────────────────────────

  @OnEvent(P2P_EVENTS.INVOICE_GENERATED)
  async onP2pInvoiceGenerated(event: { orderId: string; invoiceNumber: string; buyerTenantId: string }): Promise<void> {
    try {
      await this.notificationSvc.create({
        tenantId:    event.buyerTenantId,
        type:        'p2p_invoice_ready',
        title:       'فاتورة التحويل جاهزة',
        body:        `الفاتورة رقم ${event.invoiceNumber} متاحة للتحميل.`,
        resourceRef: `p2p_order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`P2P notification failed (invoice generated): ${err.message}`);
    }
  }

  // ─── HIGH risk recommendation generated ───────────────────────────────────

  @OnEvent(EVENTS.RECOMMENDATION_GENERATED)
  async onRecommendationGenerated(event: RecommendationGeneratedEvent): Promise<void> {
    if (event.riskLevel !== 'HIGH') return;
    try {
      await this.notificationSvc.create({
        tenantId:    event.tenantId,
        type:        'high_risk_stockout',
        title:       'Critical Stock Alert',
        body:        `A HIGH-risk stock shortage has been detected. A procurement draft has been prepared for your review.`,
        resourceRef: `recommendation:${event.recommendationId}`,
        emailSent:   false,
      });

      // Send email to all pharmacy admins of this tenant
      const admins = await this.getAdmins(event.tenantId, Role.PHARMACY_ADMIN);
      const tenant  = await this.tenantRepo.findOne({ where: { id: event.tenantId } });
      for (const admin of admins) {
        const { subject, html } = this.emailSvc.buildHighRiskStockout(
          'a product', 0, tenant?.name ?? 'Your pharmacy',
        );
        await this.emailSvc.send(admin.email, subject, html);
      }
    } catch (err: any) {
      this.logger.error(`Notification failed (recommendation): ${err.message}`);
    }
  }

  // ─── Order status changed ──────────────────────────────────────────────────

  @OnEvent(EVENTS.ORDER_STATUS_CHANGED)
  async onOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    try {
      // Notify pharmacy admin when supplier updates status
      if (['accepted', 'shipped', 'cancelled'].includes(event.to)) {
        await this.notificationSvc.create({
          tenantId:    event.pharmacyTenantId,
          type:        'order_status_changed',
          title:       `Order ${event.to.toUpperCase()}`,
          body:        `Your order has been ${event.to} by the supplier.`,
          resourceRef: `order:${event.orderId}`,
        });

        const admins = await this.getAdmins(event.pharmacyTenantId, Role.PHARMACY_ADMIN);
        const { subject, html } = this.emailSvc.buildOrderStatusChanged(
          event.orderId, event.to, 'Your order', false,
        );
        for (const admin of admins) {
          await this.emailSvc.send(admin.email, subject, html);
        }
      }

      // Notify supplier when pharmacy places order (PENDING)
      if (event.to === 'pending') {
        await this.notificationSvc.create({
          tenantId:    event.supplierTenantId,
          type:        'order_status_changed',
          title:       'New Order Received',
          body:        `A pharmacy has placed a new order. Please review and accept or decline.`,
          resourceRef: `order:${event.orderId}`,
        });

        const supplierAdmins = await this.getAdmins(event.supplierTenantId, Role.SUPPLIER_ADMIN);
        const { subject, html } = this.emailSvc.buildOrderStatusChanged(
          event.orderId, 'PENDING — action required', 'New order received', true,
        );
        for (const admin of supplierAdmins) {
          await this.emailSvc.send(admin.email, subject, html);
        }
      }
    } catch (err: any) {
      this.logger.error(`Notification failed (order status): ${err.message}`);
    }
  }

  // ─── Order delivered ───────────────────────────────────────────────────────

  @OnEvent(EVENTS.ORDER_DELIVERED)
  async onOrderDelivered(event: OrderDeliveredEvent): Promise<void> {
    try {
      await this.notificationSvc.create({
        tenantId:    event.pharmacyTenantId,
        type:        'delivery_confirmed',
        title:       'Delivery Confirmed ✓',
        body:        `Your order has been delivered and inventory updated automatically.`,
        resourceRef: `order:${event.orderId}`,
      });

      const tenant  = await this.tenantRepo.findOne({ where: { id: event.pharmacyTenantId } });
      const admins  = await this.getAdmins(event.pharmacyTenantId, Role.PHARMACY_ADMIN);
      const { subject, html } = this.emailSvc.buildDeliveryConfirmed(
        event.orderId.slice(0, 8),
        tenant?.name ?? 'Your pharmacy',
      );
      for (const admin of admins) {
        await this.emailSvc.send(admin.email, subject, html);
      }
    } catch (err: any) {
      this.logger.error(`Notification failed (delivery): ${err.message}`);
    }
  }

  // ─── AI governance: blocked input / output ────────────────────────────────

  @OnEvent(EVENTS.AI_GOVERNANCE_BLOCKED ?? 'ai.governance.blocked')
  async onAiGovernanceBlocked(event: AiGovernanceBlockedEvent): Promise<void> {
    const key  = `${event.tenantId}:${event.blockType}`;
    const last = this.aiBlockedThrottle.get(key) ?? 0;
    const now  = Date.now();
    if (now - last < NotificationEventListener.AI_BLOCKED_THROTTLE_MS) return;
    this.aiBlockedThrottle.set(key, now);

    try {
      const titleAr = event.blockType === 'input'
        ? 'تم حجب إدخال للذكاء الاصطناعي'
        : 'تم حجب مخرَج للذكاء الاصطناعي';
      const bodyAr = event.blockType === 'input'
        ? `بوابة الأمان منعت إرسال بيانات إلى المساعد. السبب: ${event.reason}`
        : `بوابة الأمان منعت ردّاً من المساعد قبل وصوله إليك. السبب: ${event.reason}`;

      await this.notificationSvc.create({
        tenantId:    event.tenantId,
        type:        'ai_governance_blocked',
        title:       titleAr,
        body:        bodyAr,
        resourceRef: `ai:blocked:${event.blockType}`,
        emailSent:   false,
      });
    } catch (err: any) {
      this.logger.error(`Notification failed (ai governance blocked): ${err.message}`);
    }
  }

  // ── P2P profile: pharmacy submits / resubmits → notify all SYSTEM_ADMINs ───

  @OnEvent(P2P_EVENTS.PROFILE_SUBMITTED)
  async onProfileSubmitted(event: { pharmacyTenantId: string; legalName: string; isResubmission: boolean }): Promise<void> {
    try {
      const admins = await this.userRepo.find({
        where: { role: Role.SYSTEM_ADMIN, isActive: true },
      });
      const title = event.isResubmission
        ? 'صيدلية عدّلت وثائقها — تحتاج مراجعة'
        : 'طلب توثيق بائع جديد';
      const body = event.isResubmission
        ? `صيدلية "${event.legalName}" استبدلت وثائقها وتحتاج إعادة مراجعة وتوثيق.`
        : `صيدلية "${event.legalName}" قدّمت ملفها للمراجعة — راجعه وأصدر قرار التوثيق.`;
      for (const admin of admins) {
        await this.notificationSvc.create({
          tenantId:    admin.tenantId,
          userId:      admin.id,
          type:        'p2p_profile_submitted',
          title,
          body,
          resourceRef: `p2p_seller:${event.pharmacyTenantId}`,
        });
      }
    } catch (err: any) {
      this.logger.error(`Profile submitted notification failed: ${err.message}`);
    }
  }

  // ── P2P profile: admin approves → notify PHARMACY ─────────────────────────

  @OnEvent(P2P_EVENTS.PROFILE_VERIFIED)
  async onProfileVerified(event: { pharmacyTenantId: string; legalName: string }): Promise<void> {
    try {
      const prefs = await this.sellerPrefs(event.pharmacyTenantId);
      await this.notificationSvc.create({
        tenantId:    event.pharmacyTenantId,
        type:        'p2p_profile_verified',
        title:       'تم توثيق حسابك كبائع 🎉',
        body:        'مبروك! تم التحقق من ملفك. إعلاناتك أصبحت مرئية للصيدليات الأخرى في شبكة التبادل.',
        resourceRef: `p2p_seller:${event.pharmacyTenantId}`,
      });
      // Send email to all pharmacy admins
      if (prefs.orderActivity !== false) {
        const admins = await this.getAdmins(event.pharmacyTenantId, Role.PHARMACY_ADMIN);
        for (const admin of admins) {
          await this.emailSvc.send(
            admin.email,
            'تم توثيق حسابك في شبكة تبادل الصيدليات ✓',
            `<p>مرحباً،</p><p>تم توثيق ملف صيدلية <strong>${event.legalName}</strong> في شبكة تبادل الصيدليات (PEN).</p><p>إعلاناتك أصبحت مرئية الآن لجميع الصيدليات في الشبكة.</p>`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Profile verified notification failed: ${err.message}`);
    }
  }

  // ── P2P profile: admin rejects → notify PHARMACY with reason ──────────────

  @OnEvent(P2P_EVENTS.PROFILE_REJECTED)
  async onProfileRejected(event: { pharmacyTenantId: string; legalName: string; reason: string }): Promise<void> {
    try {
      await this.notificationSvc.create({
        tenantId:    event.pharmacyTenantId,
        type:        'p2p_profile_rejected',
        title:       'تم رفض طلب التوثيق',
        body:        `لم يتم قبول ملف صيدلية "${event.legalName}". السبب: ${event.reason}. يمكنك تعديل بياناتك وإعادة الرفع.`,
        resourceRef: `p2p_seller:${event.pharmacyTenantId}`,
      });
      // Send email so the pharmacy doesn't miss it
      const admins = await this.getAdmins(event.pharmacyTenantId, Role.PHARMACY_ADMIN);
      for (const admin of admins) {
        await this.emailSvc.send(
          admin.email,
          'بشأن طلب توثيق حسابك في شبكة تبادل الصيدليات',
          `<p>مرحباً،</p><p>بعد مراجعة ملف <strong>${event.legalName}</strong>، تعذّر قبول الطلب للسبب التالي:</p><blockquote>${event.reason}</blockquote><p>يمكنك تعديل بياناتك أو رفع وثائق محدّثة وإعادة التقديم.</p>`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Profile rejected notification failed: ${err.message}`);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async getAdmins(tenantId: string, role: Role): Promise<User[]> {
    return this.userRepo.find({
      where: { tenantId, role, isActive: true },
    });
  }
}

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
} from '../events/domain-events';
import { Role } from '../common/enums/role.enum';

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
  ) {}

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

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async getAdmins(tenantId: string, role: Role): Promise<User[]> {
    return this.userRepo.find({
      where: { tenantId, role, isActive: true },
    });
  }
}

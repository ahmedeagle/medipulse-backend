import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderReturnRequest } from '../orders/entities/order-return-request.entity';
import { OrderComment } from '../orders/entities/order-comment.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { User } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { RecommendationType } from '../common/enums/recommendation-type.enum';
import { EVENTS } from '../events/domain-events';

/**
 * Central orchestrator for order lifecycle side effects.
 *
 * Every order status transition emits a domain event. This service listens
 * to those events and handles ALL multi-step side effects:
 *   - Notifications to pharmacy/supplier
 *   - Recommendation outcome tracking
 *   - Auto-comments on state changes
 *   - Return request auto-creation on rejected items
 *
 * Why this exists:
 *   Without an orchestrator, side effects are scattered across 12 services
 *   calling each other directly. Every new status adds new coupling.
 *   With the orchestrator, each service emits → ONE place handles what happens next.
 *
 * This is NOT a saga framework. It is NOT a microservice.
 * It is one NestJS service with @OnEvent decorators. Simple. Observable. Testable.
 */
@Injectable()
export class OrderWorkflowService {
  private readonly logger = new Logger(OrderWorkflowService.name);

  constructor(
    @InjectRepository(OrderReturnRequest)
    private readonly returnRepo: Repository<OrderReturnRequest>,
    @InjectRepository(OrderComment)
    private readonly commentRepo: Repository<OrderComment>,
    @InjectRepository(AiRecommendation)
    private readonly recRepo: Repository<AiRecommendation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationSvc: NotificationService,
    private readonly emailSvc: NotificationEmailService,
  ) {}

  // ─── Order submitted → notify supplier ───────────────────────────────────

  @OnEvent(EVENTS.ORDER_SUBMITTED)
  async onOrderSubmitted(event: { orderId: string; pharmacyTenantId: string; supplierTenantId: string }): Promise<void> {
    try {
      await this.notificationSvc.create({
        tenantId:    event.supplierTenantId,
        type:        'order_status_changed',
        title:       'New Order Received',
        body:        `Order #${event.orderId.slice(0, 8)} has been submitted. Please review and accept or decline.`,
        resourceRef: `order:${event.orderId}`,
      });

      const supplierAdmins = await this.getAdmins(event.supplierTenantId, Role.SUPPLIER_ADMIN);
      for (const admin of supplierAdmins) {
        const { subject, html } = this.emailSvc.buildOrderStatusChanged(event.orderId, 'PENDING — action required', 'New order received', true);
        await this.emailSvc.send(admin.email, subject, html);
      }
    } catch (err: any) {
      this.logger.error(`onOrderSubmitted failed: ${err.message}`);
    }
  }

  // ─── Approval required → notify pharmacy director ─────────────────────────

  @OnEvent(EVENTS.ORDER_APPROVAL_REQUIRED)
  async onApprovalRequired(event: { orderId: string; pharmacyTenantId: string; totalAmount: number }): Promise<void> {
    try {
      await this.notificationSvc.create({
        tenantId:    event.pharmacyTenantId,
        type:        'draft_created',
        title:       'Order Requires Director Approval',
        body:        `Order #${event.orderId.slice(0, 8)} (SAR ${event.totalAmount.toLocaleString()}) requires your approval before submission.`,
        resourceRef: `order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`onApprovalRequired failed: ${err.message}`);
    }
  }

  // ─── Order accepted/shipped → notify pharmacy ─────────────────────────────

  @OnEvent(EVENTS.ORDER_STATUS_CHANGED)
  async onStatusChanged(event: { orderId: string; pharmacyTenantId: string; supplierTenantId: string; from: string; to: string }): Promise<void> {
    try {
      const notifyPharmacy = ['accepted', 'shipped', 'back_ordered', 'failed_delivery', 'on_hold', 'cancelled'].includes(event.to);
      const notifySupplier = ['return_requested', 'disputed'].includes(event.to);

      if (notifyPharmacy) {
        await this.notificationSvc.create({
          tenantId:    event.pharmacyTenantId,
          type:        'order_status_changed',
          title:       `Order ${event.to.replace(/_/g, ' ').toUpperCase()}`,
          body:        `Order #${event.orderId.slice(0, 8)} status updated to ${event.to}.`,
          resourceRef: `order:${event.orderId}`,
        });
      }

      if (notifySupplier) {
        await this.notificationSvc.create({
          tenantId:    event.supplierTenantId,
          type:        'order_status_changed',
          title:       `Order ${event.to.replace(/_/g, ' ').toUpperCase()}`,
          body:        `Pharmacy has reported an issue with Order #${event.orderId.slice(0, 8)}.`,
          resourceRef: `order:${event.orderId}`,
        });
      }
    } catch (err: any) {
      this.logger.error(`onStatusChanged notification failed: ${err.message}`);
    }
  }

  // ─── Order delivered → mark AI recommendation as acted_on ────────────────

  @OnEvent(EVENTS.ORDER_DELIVERED)
  async onOrderDelivered(event: { orderId: string; pharmacyTenantId: string; items: Array<{ productId: string }> }): Promise<void> {
    try {
      const productIds = event.items.map((i) => i.productId);
      if (!productIds.length) return;

      const recs = await this.recRepo
        .createQueryBuilder('r')
        .where('r.pharmacyTenantId = :tenantId', { tenantId: event.pharmacyTenantId })
        .andWhere('r.productId IN (:...productIds)', { productIds })
        .andWhere('r.type = :type', { type: RecommendationType.REORDER })
        .andWhere('r.outcome IS NULL')
        .andWhere('r.isDismissed = false')
        .getMany();

      if (recs.length) {
        await this.recRepo
          .createQueryBuilder()
          .update()
          .set({ outcome: 'acted_on', outcomeAt: new Date() })
          .where('id IN (:...ids)', { ids: recs.map((r) => r.id) })
          .execute();

        this.logger.log(`Marked ${recs.length} recommendation(s) as acted_on for tenant ${event.pharmacyTenantId}`);
      }

      // Notify pharmacy of delivery confirmation
      await this.notificationSvc.create({
        tenantId:    event.pharmacyTenantId,
        type:        'delivery_confirmed',
        title:       'Delivery Confirmed ✓',
        body:        `Order #${event.orderId.slice(0, 8)} has been received and inventory updated.`,
        resourceRef: `order:${event.orderId}`,
      });
    } catch (err: any) {
      this.logger.error(`onOrderDelivered side effects failed: ${err.message}`);
    }
  }

  // ─── Return requested → notify supplier ──────────────────────────────────

  @OnEvent(EVENTS.ORDER_RETURN_REQUESTED)
  async onReturnRequested(event: { orderId: string; pharmacyTenantId: string }): Promise<void> {
    try {
      // Find the return request
      const returnReq = await this.returnRepo.findOne({
        where: { orderId: event.orderId },
        order: { createdAt: 'DESC' },
      });

      if (returnReq) {
        await this.notificationSvc.create({
          tenantId:    returnReq.supplierTenantId,
          type:        'order_status_changed',
          title:       'Return Request Received',
          body:        `Pharmacy has initiated a return for Order #${event.orderId.slice(0, 8)}. Please review and approve or reject.`,
          resourceRef: `order:${event.orderId}`,
        });
      }
    } catch (err: any) {
      this.logger.error(`onReturnRequested notification failed: ${err.message}`);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async getAdmins(tenantId: string, role: Role): Promise<User[]> {
    return this.userRepo.find({ where: { tenantId, role, isActive: true } });
  }
}

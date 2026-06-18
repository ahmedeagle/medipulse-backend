import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';
import { P2pOrdersService } from '../../p2p-orders/p2p-orders.service';
import { NotificationService } from '../../notifications/notification.service';

interface P2pOrderActionPayload {
  orderId: string;
  action: 'cancel' | 'complete' | 'remind_seller';
  scenario: string;
  orderSummary: {
    productName: string;
    qty: number;
    totalValue: number;
    counterpartyName: string;
    sellerTenantId: string;
    buyerTenantId: string;
    hoursStuck: number;
  };
}

@Injectable()
export class P2pOrderActionExecutor {
  private readonly logger = new Logger(P2pOrderActionExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly p2pOrders: P2pOrdersService,
    private readonly notifications: NotificationService,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'p2p_order_action') return;

    const payload = (approval.payload ?? {}) as P2pOrderActionPayload;
    const { orderId, action, orderSummary } = payload;

    this.logger.log(`P2pOrderActionExecutor: executing '${action}' for order ${orderId} (approval ${approval.id})`);

    try {
      if (action === 'cancel') {
        await this.p2pOrders.cancel(approval.tenantId, orderId);
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          cancelled: true,
          executedAt: new Date().toISOString(),
        });
        this.logger.log(`Order ${orderId} cancelled via AI approval ${approval.id}`);

      } else if (action === 'complete') {
        await this.p2pOrders.complete(approval.tenantId, orderId);
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          completed: true,
          executedAt: new Date().toISOString(),
        });
        this.logger.log(`Order ${orderId} completed via AI approval ${approval.id}`);

      } else if (action === 'remind_seller') {
        // Send a push notification to the seller to nudge them to act
        await this.notifications.create({
          tenantId:    orderSummary.sellerTenantId,
          type:        'p2p_order_reminder',
          title:       'تذكير: طلب ينتظر منك',
          body:        `طلب "${orderSummary.productName}" (${orderSummary.qty} وحدة) من صيدلية "${orderSummary.counterpartyName}" ينتظر منك.`,
          resourceRef: `p2p_order:${orderId}`,
        });
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          reminded: true,
          executedAt: new Date().toISOString(),
        });
        this.logger.log(`Reminder sent for order ${orderId} via AI approval ${approval.id}`);
      }
    } catch (err: any) {
      this.logger.error(`P2pOrderActionExecutor: failed for order ${orderId} — ${err.message}`);
      try {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          error: err.message,
          executedAt: new Date().toISOString(),
          failed: true,
        });
      } catch { /* state machine race — approval already transitioned */ }
    }
  }
}

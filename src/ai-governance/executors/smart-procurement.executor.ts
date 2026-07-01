import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';
import { P2P_EVENTS } from '../../events/domain-events';
import { RecoveryEventService } from '../../recovery/recovery-event.service';

interface SmartProcurementPayload {
  sourceType: 'p2p' | 'supplier';
  p2pListingId?: string;
  supplierTenantId?: string;
  productId: string;
  productName?: string;
  quantity: number;
  agreedPrice?: number;
  totalCost?: number;
}

@Injectable()
export class SmartProcurementExecutor {
  private readonly logger = new Logger(SmartProcurementExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly recovery: RecoveryEventService,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'smart_procurement') return;

    const payload = (approval.payload ?? {}) as SmartProcurementPayload;

    try {
      if (payload.sourceType === 'p2p' && payload.p2pListingId) {
        await this.executeProcurementFromP2P(approval, payload);
      } else {
        await this.executeProcurementFromSupplier(approval, payload);
      }

      // Measurement layer: realized saving vs historical average on this buy.
      const saved = Number(
        (approval.payload as any)?.explainability?.financialImpact?.savedVsHistoricalAvg ?? 0,
      );
      if (saved > 0) {
        await this.recovery.record({
          pharmacyTenantId: approval.tenantId,
          type:             payload.sourceType === 'p2p' ? 'p2p_saving' : 'purchase_saving',
          status:           'realized',
          amountEgp:        saved,
          expectedValueEgp: saved,
          realizedValueEgp: saved,
          productId:        payload.productId ?? null,
          sourceType:       'approval',
          sourceId:         approval.id,
          subjectType:      'smart_procurement',
        });
      }
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`SmartProcurement ${approval.id} execution failed: ${reason}`);
      try {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          error: reason,
          executedAt: new Date().toISOString(),
          failed: true,
        });
      } catch { /* state machine race — ignore */ }
    }
  }

  private async executeProcurementFromP2P(
    approval: Approval,
    payload: SmartProcurementPayload,
  ): Promise<void> {
    const listingRepo = this.dataSource.getRepository('p2p_listings');
    const orderRepo   = this.dataSource.getRepository('p2p_orders');

    const listing = await listingRepo.findOne({ where: { id: payload.p2pListingId } }) as any;
    if (!listing) throw new Error(`P2P listing ${payload.p2pListingId} not found`);
    if (listing.status !== 'active') throw new Error('Listing is no longer active');
    if (listing.quantity < payload.quantity) throw new Error('Insufficient quantity on listing');

    const order = orderRepo.create({
      buyerTenantId:  approval.tenantId,
      sellerTenantId: listing.sellerTenantId,
      listingId:      payload.p2pListingId,
      requestedQty:   payload.quantity,
      agreedPrice:    listing.price,
      notes:          'طلب ذكي تلقائي — موافقة من مركز الذكاء الاصطناعي',
      status:         'pending',
    });
    const saved = await orderRepo.save(order) as any;

    this.eventEmitter.emit(P2P_EVENTS.ORDER_CREATED, {
      orderId:        saved.id,
      sellerTenantId: listing.sellerTenantId,
      buyerTenantId:  approval.tenantId,
    });

    await this.approvals.markExecuted(approval.tenantId, approval.id, {
      p2pOrderId:  saved.id,
      executedAt:  new Date().toISOString(),
      sourceType:  'p2p',
    });
    this.logger.log(`SmartProcurement ${approval.id} → P2P order ${saved.id}`);
  }

  private async executeProcurementFromSupplier(
    approval: Approval,
    payload: SmartProcurementPayload,
  ): Promise<void> {
    const draftRepo = this.dataSource.getRepository('procurement_drafts');

    const draft = draftRepo.create({
      pharmacyTenantId:  approval.tenantId,
      supplierTenantId:  payload.supplierTenantId ?? null,
      productId:         payload.productId,
      suggestedQuantity: payload.quantity,
      unitPrice:         payload.agreedPrice ?? 0,
      currency:          'EGP',
      urgencyLevel:      'high',
      status:            'pending_review',
      expiresAt:         new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const saved = await draftRepo.save(draft) as any;

    await this.approvals.markExecuted(approval.tenantId, approval.id, {
      draftId:     saved.id,
      executedAt:  new Date().toISOString(),
      sourceType:  'supplier',
    });
    this.logger.log(`SmartProcurement ${approval.id} → procurement draft ${saved.id}`);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { P2P_EVENTS, PURCHASE_EVENTS } from '../events/domain-events';
import { RecoveryEventService } from './recovery-event.service';

/**
 * Closes the projected → realized loop for the recovery ledger.
 *
 * Decoupled by design: engines emit domain events, this listener reacts. The P2P
 * order flow does NOT know about the recovery ledger — it just emits ORDER_COMPLETED.
 *
 * Runs async so measurement never adds latency to (or can break) the order path.
 */
@Injectable()
export class RecoveryFinalizationListener {
  private readonly logger = new Logger(RecoveryFinalizationListener.name);

  constructor(private readonly recovery: RecoveryEventService) {}

  @OnEvent(P2P_EVENTS.ORDER_COMPLETED, { async: true })
  async onP2pOrderCompleted(event: {
    orderId: string;
    buyerTenantId: string;
    sellerTenantId: string;
  }): Promise<void> {
    if (!event?.orderId) return;
    await this.recovery.finalizeP2pOrderCompletion(event.orderId);
  }

  /**
   * A confirmed supplier return is realized money back from the supplier.
   * Idempotent per return via (sourceType='return', returnId, 'return_recovery').
   */
  @OnEvent(PURCHASE_EVENTS.RETURN_CONFIRMED, { async: true })
  async onPurchaseReturnConfirmed(event: {
    pharmacyTenantId: string;
    returnId: string;
    grandTotal: number;
    supplierTenantId: string | null;
    supplierName: string | null;
  }): Promise<void> {
    if (!event?.returnId || !(Number(event.grandTotal) > 0)) return;
    await this.recovery.record({
      pharmacyTenantId: event.pharmacyTenantId,
      type:             'return_recovery',
      status:           'realized',
      amountEgp:        Number(event.grandTotal),
      realizedValueEgp: Number(event.grandTotal),
      sourceType:       'return',
      sourceId:         event.returnId,
      subjectType:      'purchase_return',
      metadata: {
        supplierTenantId: event.supplierTenantId,
        supplierName: event.supplierName,
      },
    });
  }
}

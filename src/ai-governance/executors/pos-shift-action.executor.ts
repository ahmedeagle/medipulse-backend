import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalService } from '../approval.service';
import { NotificationService } from '../../notifications/notification.service';

interface PosShiftActionPayload {
  scenario:         'cash_mismatch' | 'high_refund_rate';
  shiftId:          string;
  cashierName:      string | null;
  totalSales:       number;
  totalReturns?:    number;
  refundRate?:      number;
  variance?:        number;
  declaredBalance?: number;
  systemExpected?:  number;
  transactionCount: number;
  returnCount?:     number;
}

@Injectable()
export class PosShiftActionExecutor {
  constructor(
    private readonly approvalService: ApprovalService,
    private readonly notifications:   NotificationService,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(event: any) {
    if (event.approval.subjectType !== 'pos_shift_action') return;
    const p = event.approval.payload as PosShiftActionPayload;

    try {
      // For pos_shift_action, the "action" is always investigation/acknowledgement.
      // The AI has already flagged and notified; approval means the manager reviewed it.
      const resultNote =
        p.scenario === 'cash_mismatch'
          ? `تم الاطلاع على الفرق النقدي EGP ${p.variance?.toFixed(2)} في شفت الكاشير ${p.cashierName ?? '—'}`
          : `تم الاطلاع على نسبة المرتجعات ${p.refundRate}% في شفت الكاشير ${p.cashierName ?? '—'}`;

      await this.approvalService.markExecuted(
        event.approval.tenantId,
        event.approval.id,
        { acknowledged: true, note: resultNote },
        { type: 'agent' },
      );

      // Notify the tenant that investigation is complete
      await this.notifications.create({
        tenantId:    event.approval.tenantId,
        type:        'pos_integrity_resolved',
        title:       'تم مراجعة تنبيه سلامة الشفت',
        body:        resultNote,
        resourceRef: `pos_shift:${p.shiftId}`,
      });
    } catch (err) {
      await this.approvalService.markExecuted(
        event.approval.tenantId,
        event.approval.id,
        { error: err?.message },
        { type: 'agent' },
      );
    }
  }
}

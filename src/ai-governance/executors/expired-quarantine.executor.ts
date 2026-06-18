import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';

interface ExpiredQuarantinePayload {
  inventoryItemId: string;
  productId: string;
  productName?: string;
  quantity: number;
}

@Injectable()
export class ExpiredQuarantineExecutor {
  private readonly logger = new Logger(ExpiredQuarantineExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'expired_quarantine') return;

    const payload = (approval.payload ?? {}) as ExpiredQuarantinePayload;

    try {
      await this.dataSource.transaction(async (mgr) => {
        // 1. Mark all active batches for this inventory item as quarantined
        await mgr
          .getRepository('product_batches')
          .createQueryBuilder()
          .update()
          .set({ status: 'quarantined' })
          .where('"inventoryItemId" = :id AND status = :s', {
            id: payload.inventoryItemId,
            s: 'active',
          })
          .execute();

        // 2. Zero out the inventory quantity so it disappears from stock
        await mgr
          .getRepository('inventory_items')
          .createQueryBuilder()
          .update()
          .set({ quantity: 0 })
          .where('id = :id AND "pharmacyTenantId" = :tenant', {
            id:     payload.inventoryItemId,
            tenant: approval.tenantId,
          })
          .execute();
      });

      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        quarantinedAt:   new Date().toISOString(),
        inventoryItemId: payload.inventoryItemId,
        unitsQuarantined: payload.quantity,
      });
      this.logger.log(
        `ExpiredQuarantine ${approval.id} → item ${payload.inventoryItemId} quarantined`,
      );
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`ExpiredQuarantine ${approval.id} failed: ${reason}`);
      try {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          error:      reason,
          executedAt: new Date().toISOString(),
          failed:     true,
        });
      } catch { /* state machine race */ }
    }
  }
}

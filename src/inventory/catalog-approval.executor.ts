import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { InventoryService } from './inventory.service';
import { ApprovalService } from '../ai-governance/approval.service';
import { Approval } from '../ai-governance/entities/approval.entity';

/**
 * Executes Catalog-Expert approvals. When the user approves an
 * `inventory_item` link suggestion in the AI Center, this listener calls the
 * existing `linkToProduct` path so the item is officially linked to its
 * canonical catalog product, then marks the approval as `executed`.
 */
@Injectable()
export class CatalogApprovalExecutor {
  private readonly logger = new Logger(CatalogApprovalExecutor.name);

  constructor(
    private readonly inventory: InventoryService,
    private readonly approvals: ApprovalService,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'inventory_item') return;
    const payload = (approval.payload ?? {}) as {
      itemId?:             string;
      suggestedProductId?: string;
      matchScore?:         number;
      signals?:            string[];
    };
    const itemId    = payload.itemId            ?? approval.subjectId;
    const productId = payload.suggestedProductId;
    if (!itemId || !productId) return;

    try {
      await this.inventory.linkToProduct(approval.tenantId, itemId, productId, {
        score:   payload.matchScore ?? 90,
        signals: payload.signals    ?? [],
        reasons: ['user_approved_via_ai_center'],
      });
      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        linked:     true,
        executedAt: new Date().toISOString(),
      });
      this.logger.log(`approval ${approval.id} executed → item ${itemId} linked to ${productId}`);
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`approval ${approval.id} link failed: ${reason}`);
      try {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          error:      reason,
          executedAt: new Date().toISOString(),
          failed:     true,
        });
      } catch {
        /* race */
      }
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { ProcurementDraftService } from './procurement-draft.service';
import { ApprovalService } from '../ai-governance/approval.service';
import { Approval } from '../ai-governance/entities/approval.entity';

/**
 * Executes Purchase-Expert approvals. When the user approves a
 * `procurement_draft` approval in the AI Center, this listener turns the
 * underlying draft into a real Order via the existing approveDraft path,
 * then marks the approval as `executed`.
 *
 * If approveDraft throws (supplier stock change, expired draft, etc.) the
 * approval is rejected so it disappears from the pending queue and the user
 * sees the failure reason.
 */
@Injectable()
export class PurchaseApprovalExecutor {
  private readonly logger = new Logger(PurchaseApprovalExecutor.name);

  constructor(
    private readonly drafts:    ProcurementDraftService,
    private readonly approvals: ApprovalService,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'procurement_draft') return;
    const payload = (approval.payload ?? {}) as { draftId?: string; quantity?: number };
    const draftId = payload.draftId ?? approval.subjectId;
    if (!draftId) return;

    try {
      const order = await this.drafts.approveDraft(approval.tenantId, draftId);
      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        orderId:    order?.id,
        executedAt: new Date().toISOString(),
      });
      this.logger.log(`approval ${approval.id} executed → order ${order?.id}`);
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`approval ${approval.id} execution failed: ${reason}`);

      // Reject the underlying draft so the cron won't regenerate the same
      // failed approval every 5 minutes. We swallow the rejectDraft error
      // (e.g. draft already in non-pending state) — the executionResult on
      // the approval is the source of truth either way.
      try {
        await this.drafts.rejectDraft(approval.tenantId, draftId, `Auto-rejected after execution failure: ${reason}`);
      } catch (rejectErr) {
        this.logger.warn(
          `couldn't reject draft ${draftId} after exec failure: ${(rejectErr as Error).message}`,
        );
      }

      // Mark the approval as executed-with-failure. The row stays visible
      // in the AI Center under "Failed execution" so the pharmacist sees
      // exactly what went wrong and can act manually if needed.
      try {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          error:      reason,
          executedAt: new Date().toISOString(),
          failed:     true,
        });
      } catch {
        /* state machine race — ignore */
      }
    }
  }
}

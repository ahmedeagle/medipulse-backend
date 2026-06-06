import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApprovalService } from './approval.service';

/**
 * Hourly sweeper — flips `pending|modified` approvals past their `expiresAt`
 * to `expired`. PRD §11 future-extension: every governance system needs an
 * automatic TTL so stale recommendations don't clutter the queue forever.
 */
@Injectable()
export class ApprovalScheduler {
  private readonly logger = new Logger(ApprovalScheduler.name);
  constructor(private readonly approvals: ApprovalService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'approvals-expire-sweeper' })
  async expireDue(): Promise<void> {
    try {
      const n = await this.approvals.expireDue();
      if (n > 0) this.logger.log(`[scheduler] expired ${n} stale approval(s)`);
    } catch (err: any) {
      this.logger.error(`[scheduler] expire sweep failed: ${err.message}`, err.stack);
    }
  }
}

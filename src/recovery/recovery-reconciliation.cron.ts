import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RecoveryEventService } from './recovery-event.service';

/**
 * Closes the failure side of the recovery loop (PRD v1.2). Daily, any projected
 * recovery whose P2P listing has expired unsold is marked terminal (lost/expired),
 * so the "pipeline" KPI reflects only value still recoverable — never inflated.
 */
@Injectable()
export class RecoveryReconciliationCron {
  private readonly logger = new Logger(RecoveryReconciliationCron.name);

  constructor(private readonly recovery: RecoveryEventService) {}

  // Daily at 03:30 — after listing-expiry crons have run.
  @Cron('30 3 * * *')
  async reconcile(): Promise<void> {
    try {
      const { lost, expired } = await this.recovery.reconcileStaleProjections();
      this.logger.log(`RecoveryReconciliationCron: lost=${lost}, expired=${expired}`);
    } catch (err) {
      this.logger.error(`RecoveryReconciliationCron failed: ${(err as Error)?.message ?? err}`);
    }
  }
}

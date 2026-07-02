import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RecoveryEvent } from './entities/recovery-event.entity';
import { RecoveryEventService } from './recovery-event.service';
import { RecoveryFinalizationListener } from './recovery-finalization.listener';
import { RecoveryReconciliationCron } from './recovery-reconciliation.cron';
import { RecoveryController } from './recovery.controller';

/**
 * Financial Impact Measurement layer. Exported so executors (procurement,
 * ai-governance) can record outcomes and the report service can aggregate them.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RecoveryEvent])],
  controllers: [RecoveryController],
  providers: [RecoveryEventService, RecoveryFinalizationListener, RecoveryReconciliationCron],
  exports: [RecoveryEventService],
})
export class RecoveryModule {}

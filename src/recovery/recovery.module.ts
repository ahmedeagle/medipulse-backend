import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RecoveryEvent } from './entities/recovery-event.entity';
import { RecoveryEventService } from './recovery-event.service';

/**
 * Financial Impact Measurement layer. Exported so executors (procurement,
 * ai-governance) can record outcomes and the report service can aggregate them.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RecoveryEvent])],
  providers: [RecoveryEventService],
  exports: [RecoveryEventService],
})
export class RecoveryModule {}

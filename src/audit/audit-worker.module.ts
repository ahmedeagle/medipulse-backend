import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AuditEventProcessor } from './audit-event.processor';
import { AuditEvent } from './entities/audit-event.entity';
import { AUDIT_QUEUE } from './audit.constants';

/**
 * Imported only by WorkerAppModule.
 * Contains the processor that consumes the audit queue and writes to the audit DB.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AuditEvent], 'audit'),
    BullModule.registerQueue({ name: AUDIT_QUEUE }),
  ],
  providers: [AuditEventProcessor],
})
export class AuditWorkerModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor';
import { AuditReadInterceptor } from './audit-read.interceptor';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditEvent } from './entities/audit-event.entity';
import { ReadAccessLog } from './entities/read-access-log.entity';
import { AUDIT_QUEUE } from './audit.constants';

/**
 * Imported by the main HTTP app.
 *
 * Two interceptors registered globally:
 *   AuditInterceptor     — every POST/PATCH/DELETE (mutation audit)
 *   AuditReadInterceptor — only routes decorated with @AuditRead() (read-access audit)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AuditEvent], 'audit'),
    TypeOrmModule.forFeature([ReadAccessLog], 'audit'),
    BullModule.registerQueue({ name: AUDIT_QUEUE }),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditReadInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}

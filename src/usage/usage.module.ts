import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsageCounter } from './entities/usage-counter.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';
import { AiUsageGuard } from './ai-usage.guard';

/**
 * Metered-usage layer. Exported so the chat module can guard AI calls and the
 * notification dispatcher can gate WhatsApp sends against plan caps. Writes its
 * "credits finished" notification via the Notification repo directly (no dependency
 * on NotificationsModule) to keep the dependency graph acyclic.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UsageCounter, Tenant, Notification])],
  controllers: [UsageController],
  providers: [UsageService, AiUsageGuard],
  exports: [UsageService, AiUsageGuard],
})
export class UsageModule {}

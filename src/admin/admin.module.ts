import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DlqService } from './dlq.service';
import { Tenant } from '../auth/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';
import { AI_RECOMMENDATIONS_QUEUE } from '../ai/ai.constants';
import { AUDIT_QUEUE } from '../audit/audit.constants';
import { WEBHOOK_DELIVERY_QUEUE } from '../webhooks/webhook.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, User]),
    BullModule.registerQueue(
      { name: AI_RECOMMENDATIONS_QUEUE },
      { name: AUDIT_QUEUE },
      { name: WEBHOOK_DELIVERY_QUEUE },
    ),
  ],
  controllers: [AdminController],
  providers: [AdminService, DlqService],
  exports: [AdminService],
})
export class AdminModule {}

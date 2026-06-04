import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutoDraftSchedulerService } from './auto-draft-scheduler.service';
import { ProcurementDraft } from './entities/procurement-draft.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { ProcurementSchedule } from '../forecasting/entities/procurement-schedule.entity';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Imported only by WorkerAppModule.
 * Contains the 6am daily auto-draft cron job.
 * This closes Phase 4: drafts are prepared automatically every morning
 * without waiting for the pharmacist to click "Generate".
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProcurementDraft,
      AiRecommendation,
      SupplierCatalogItem,
      ProcurementSchedule,
      User,
      Tenant,
    ]),
    NotificationsModule,
  ],
  providers: [AutoDraftSchedulerService],
})
export class ProcurementWorkerModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutoDraftSchedulerService } from './auto-draft-scheduler.service';
import { ProcurementModule } from './procurement.module';
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
 *
 * P1: now wires the AutoDraftScheduler to the multi-signal
 * ProcurementOrchestrator (Decision Engine v1) so generated drafts honour
 * supplier reliability, P2P alternatives, market shortage signals and
 * financial-health gating instead of the legacy cheapest-only logic.
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
    // Re-uses the full HTTP-app procurement module so we get
    // ProcurementOrchestrator + ConflictResolutionEngine without duplicating
    // their dependency graph. Each Nest app (HTTP / worker) gets its own
    // listener instance — they cannot cross-fire because EventEmitter is
    // in-process only.
    ProcurementModule,
  ],
  providers: [AutoDraftSchedulerService],
})
export class ProcurementWorkerModule {}

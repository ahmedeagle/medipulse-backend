import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';
import { RecommendationOutcomeListener } from './recommendation-outcome.listener';
import { RegionalSignalComputerService } from './regional-signal-computer.service';
import { WeeklyAnalyticsSnapshot } from './entities/weekly-analytics-snapshot.entity';
import { DomainEventLog } from './entities/domain-event-log.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { RegionalDemandSignal } from '../inventory/entities/regional-demand-signal.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WeeklyAnalyticsSnapshot,
      AiRecommendation,
      Tenant,
      RegionalDemandSignal,
    ]),
    TypeOrmModule.forFeature([DomainEventLog], 'audit'),
  ],
  providers: [AnalyticsSnapshotService, RecommendationOutcomeListener, RegionalSignalComputerService],
  exports: [AnalyticsSnapshotService, RegionalSignalComputerService],
})
export class AnalyticsWorkerModule {}

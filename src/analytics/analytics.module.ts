import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainEventStoreListener } from './domain-event-store.listener';
import { PriceSnapshotListener } from './price-snapshot.listener';
import { RecommendationOutcomeListener } from './recommendation-outcome.listener';
import { AnalyticsReadService } from './analytics-read.service';
import { AnalyticsController } from './analytics.controller';
import { DomainEventLog } from './entities/domain-event-log.entity';
import { PriceSnapshot } from './entities/price-snapshot.entity';
import { WeeklyAnalyticsSnapshot } from './entities/weekly-analytics-snapshot.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierProfile } from '../supplier/entities/supplier-profile.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { Tenant } from '../auth/entities/tenant.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DomainEventLog], 'audit'),
    TypeOrmModule.forFeature([
      PriceSnapshot,
      SupplierCatalogItem,
      SupplierProfile,
      AiRecommendation,
      InventoryItem,
      WeeklyAnalyticsSnapshot,
      Tenant,
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [
    DomainEventStoreListener,
    PriceSnapshotListener,
    RecommendationOutcomeListener,
    AnalyticsReadService,
  ],
  exports: [AnalyticsReadService],
})
export class AnalyticsModule {}

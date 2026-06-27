import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiService } from './ai.service';
import { AiGenerationProcessor } from './ai-generation.processor';
import { RecommendationDecisionTrace } from './entities/recommendation-decision-trace.entity';
import { AiRecommendation } from './entities/ai-recommendation.entity';
import { AiAuditLog } from './entities/ai-audit-log.entity';
import { InventoryService } from '../inventory/inventory.service';
import { ConsumptionAnalyticsService } from '../inventory/consumption-analytics.service';
import { CatalogMatchingService } from '../inventory/catalog-matching.service';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Product } from '../inventory/entities/product.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { RegionalDemandSignal } from '../inventory/entities/regional-demand-signal.entity';
import { SupplierModule } from '../supplier/supplier.module';
import { ForecastingModule } from '../forecasting/forecasting.module';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { AiRateLimiter } from './governance/rate-limiter';
import { AiTokenBudget } from './governance/token-budget';
import { DynamicAgentRunner } from './governance/dynamic-agent-runner';
import { AgentDefinition } from '../ai-governance/entities/agent-definition.entity';
import { RedisModule } from '../common/redis/redis.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PharmacySettingsModule } from '../pharmacy-settings/pharmacy-settings.module';
import { AI_RECOMMENDATIONS_QUEUE } from './ai.constants';

@Module({
  imports: [
    // Order AND OrderItem must be registered together — Order.items is @OneToMany(() => OrderItem)
    TypeOrmModule.forFeature([
      AiRecommendation,
      AiAuditLog,
      RecommendationDecisionTrace,
      Order,
      OrderItem,
      AgentDefinition,
      // Inventory entities needed by InventoryService and ConsumptionAnalyticsService
      InventoryItem,
      Product,
      ConsumptionSnapshot,
      RegionalDemandSignal,
    ]),
    BullModule.registerQueue({ name: AI_RECOMMENDATIONS_QUEUE }),
    SupplierModule,
    ForecastingModule,
    RedisModule,
    NotificationsModule,
    PharmacySettingsModule,
  ],
  // Provide inventory services directly — avoids importing InventoryModule which carries HTTP controllers
  providers: [AiService, AiRateLimiter, AiTokenBudget, DynamicAgentRunner, AiGenerationProcessor, InventoryService, ConsumptionAnalyticsService, CatalogMatchingService],
})
export class AiWorkerModule {}

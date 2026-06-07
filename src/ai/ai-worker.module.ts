import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiService } from './ai.service';
import { AiGenerationProcessor } from './ai-generation.processor';
import { RecommendationDecisionTrace } from './entities/recommendation-decision-trace.entity';
import { AiRecommendation } from './entities/ai-recommendation.entity';
import { AiAuditLog } from './entities/ai-audit-log.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { SupplierModule } from '../supplier/supplier.module';
import { ForecastingModule } from '../forecasting/forecasting.module';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { AiRateLimiter } from './governance/rate-limiter';
import { AiTokenBudget } from './governance/token-budget';
import { DynamicAgentRunner } from './governance/dynamic-agent-runner';
import { AgentDefinition } from '../ai-governance/entities/agent-definition.entity';
import { RedisModule } from '../common/redis/redis.module';
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
    ]),
    BullModule.registerQueue({ name: AI_RECOMMENDATIONS_QUEUE }),
    forwardRef(() => InventoryModule),
    SupplierModule,
    ForecastingModule,
    RedisModule,
  ],
  providers: [AiService, AiRateLimiter, AiTokenBudget, DynamicAgentRunner, AiGenerationProcessor],
})
export class AiWorkerModule {}

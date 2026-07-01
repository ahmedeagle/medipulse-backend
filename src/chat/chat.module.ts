import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryItem }    from '../inventory/entities/inventory-item.entity';
import { Approval }         from '../ai-governance/entities/approval.entity';
import { PriceSnapshot }    from '../analytics/entities/price-snapshot.entity';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage }      from './entities/chat-message.entity';
import { DashboardService } from '../ai-governance/dashboard.service';
import { DeadStockService } from '../inventory/dead-stock.service';
import { AiTokenBudget }    from '../ai/governance/token-budget';
import { RedisModule }      from '../common/redis/redis.module';
import { ChatAnswerCache }  from './chat-answer.cache';
import { ChatService }      from './chat.service';
import { ChatController }   from './chat.controller';
import { UsageModule }      from '../usage/usage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem, Approval, PriceSnapshot, ChatConversation, ChatMessage]),
    RedisModule,
    UsageModule,
  ],
  providers:   [ChatService, DashboardService, DeadStockService, AiTokenBudget, ChatAnswerCache],
  controllers: [ChatController],
})
export class ChatModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryItem }    from '../inventory/entities/inventory-item.entity';
import { Approval }         from '../ai-governance/entities/approval.entity';
import { PriceSnapshot }    from '../analytics/entities/price-snapshot.entity';
import { DashboardService } from '../ai-governance/dashboard.service';
import { DeadStockService } from '../inventory/dead-stock.service';
import { ChatService }      from './chat.service';
import { ChatController }   from './chat.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem, Approval, PriceSnapshot]),
  ],
  providers:   [ChatService, DashboardService, DeadStockService],
  controllers: [ChatController],
})
export class ChatModule {}

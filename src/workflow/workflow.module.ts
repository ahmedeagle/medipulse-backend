import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderWorkflowService } from './order-workflow.service';
import { ComplianceWorkflowService } from './compliance-workflow.service';
import { OrderReturnRequest } from '../orders/entities/order-return-request.entity';
import { OrderComment } from '../orders/entities/order-comment.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { ProductBatch } from '../inventory/entities/product-batch.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderReturnRequest, OrderComment, AiRecommendation,
      ProductBatch, InventoryItem, User,
    ]),
    NotificationsModule,
  ],
  providers: [OrderWorkflowService, ComplianceWorkflowService],
  exports: [OrderWorkflowService, ComplianceWorkflowService],
})
export class WorkflowModule {}

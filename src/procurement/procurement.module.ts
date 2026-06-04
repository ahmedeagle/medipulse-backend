import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcurementController } from './procurement.controller';
import { ProcurementDraftService } from './procurement-draft.service';
import { ProcurementDraftListener } from './procurement-draft.listener';
import { ProcurementDraft } from './entities/procurement-draft.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProcurementDraft,
      AiRecommendation,
      SupplierCatalogItem,
      SupplierReliabilityScore,
      InventoryItem,
      Order,
      OrderItem,
    ]),
  ],
  controllers: [ProcurementController],
  providers: [ProcurementDraftService, ProcurementDraftListener],
  exports: [ProcurementDraftService],
})
export class ProcurementModule {}

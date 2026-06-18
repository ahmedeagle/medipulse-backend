import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcurementController } from './procurement.controller';
import { ProcurementDraftService } from './procurement-draft.service';
import { ProcurementDraftListener } from './procurement-draft.listener';
import { PurchaseApprovalExecutor } from './purchase-approval.executor';
import { ProcurementDraft } from './entities/procurement-draft.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { PharmacySettingsModule } from '../pharmacy-settings/pharmacy-settings.module';

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
    forwardRef(() => AiGovernanceModule),
    PharmacySettingsModule,
  ],
  controllers: [ProcurementController],
  providers: [ProcurementDraftService, ProcurementDraftListener, PurchaseApprovalExecutor],
  exports: [ProcurementDraftService],
})
export class ProcurementModule {}

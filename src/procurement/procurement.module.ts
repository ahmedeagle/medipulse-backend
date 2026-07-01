import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProcurementController } from './procurement.controller';
import { ProcurementDraftService } from './procurement-draft.service';
import { ProcurementDraftListener } from './procurement-draft.listener';
import { PurchaseApprovalExecutor } from './purchase-approval.executor';
import { PurchaseBasketExecutor } from './purchase-basket.executor';
import { ProcurementOrchestrator } from './procurement-orchestrator.service';
import { ConflictResolutionEngine } from './conflict-resolution.engine';
import { ProcurementCartService } from './procurement-cart.service';
import { ProcurementOrderBuilder } from './procurement-order.builder';
import { AskAgentService } from './ask-agent.service';
import { DrugNeedService } from './drug-need.service';
import { DrugNeedController } from './drug-need.controller';
import { DemandBroadcastService } from './demand-broadcast.service';

import { ProcurementDraft } from './entities/procurement-draft.entity';
import { DrugNeedRequest } from './entities/drug-need-request.entity';
import { Product } from '../inventory/entities/product.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { SupplierProfile } from '../supplier/entities/supplier-profile.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';

import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { PharmacySettingsModule } from '../pharmacy-settings/pharmacy-settings.module';
import { ForecastingModule } from '../forecasting/forecasting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { P2pMarketplaceModule } from '../p2p-marketplace/p2p-marketplace.module';
import { SupplierModule } from '../supplier/supplier.module';
import { FinancialModule } from '../financial/financial.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecoveryModule } from '../recovery/recovery.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProcurementDraft,
      DrugNeedRequest,
      Product,
      AiRecommendation,
      SupplierCatalogItem,
      SupplierReliabilityScore,
      SupplierProfile,
      Tenant,
      InventoryItem,
      Order,
      OrderItem,
    ]),
    forwardRef(() => AiGovernanceModule),
    forwardRef(() => ForecastingModule),
    forwardRef(() => InventoryModule),
    forwardRef(() => P2pMarketplaceModule),
    SupplierModule,
    FinancialModule,
    AnalyticsModule,
    PharmacySettingsModule,
    NotificationsModule,
    RecoveryModule,
  ],
  controllers: [ProcurementController, DrugNeedController],
  providers: [
    ProcurementDraftService,
    DrugNeedService,
    DemandBroadcastService,
    ProcurementDraftListener,
    PurchaseApprovalExecutor,
    PurchaseBasketExecutor,
    ConflictResolutionEngine,
    ProcurementOrchestrator,
    ProcurementCartService,
    ProcurementOrderBuilder,
    AskAgentService,
  ],
  exports: [ProcurementDraftService, ProcurementOrchestrator, ProcurementCartService, DrugNeedService],
})
export class ProcurementModule {}

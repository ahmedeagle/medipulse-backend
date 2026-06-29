import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { BullModule } from '@nestjs/bullmq';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ConsumptionAnalyticsService } from './consumption-analytics.service';
import { InventoryImportService } from './inventory-import.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import { BatchesService } from './batches.service';
import { ProductRecallService } from './product-recall.service';
import { ProductRecallController } from './product-recall.controller';
import { CatalogMatchingService } from './catalog-matching.service';
import { CatalogEmbeddingsService } from './catalog-embeddings.service';
import { ImportBatchService } from './import-batch.service';
import { CatalogApprovalExecutor } from './catalog-approval.executor';
import { ExpiredInventoryCron } from './expired-inventory.cron';
import { LowStockCron } from './low-stock.cron';
import { LostRevenueCron } from './lost-revenue.cron';
import { InventoryItem } from './entities/inventory-item.entity';
import { Product } from './entities/product.entity';
import { ConsumptionSnapshot } from './entities/consumption-snapshot.entity';
import { RegionalDemandSignal } from './entities/regional-demand-signal.entity';
import { ProductBatch } from './entities/product-batch.entity';
import { ProductRecall } from './entities/product-recall.entity';
import { ImportBatch } from './entities/import-batch.entity';
import { ImportBatchRow } from './entities/import-batch-row.entity';
import { NormalizationModule } from '../normalization/normalization.module';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PharmacySettingsModule } from '../pharmacy-settings/pharmacy-settings.module';
import { MATCH_QUEUE } from './match.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryItem, Product, ConsumptionSnapshot, RegionalDemandSignal,
      ProductBatch, ProductRecall, ImportBatch, ImportBatchRow,
    ]),
    MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }),
    BullModule.registerQueue({ name: MATCH_QUEUE }),
    NormalizationModule,
    forwardRef(() => AiGovernanceModule),
    NotificationsModule,
    PharmacySettingsModule,
  ],
  controllers: [InventoryController, ProductRecallController],
  providers: [InventoryService, ConsumptionAnalyticsService, InventoryImportService, BarcodeLookupService, BatchesService, ProductRecallService, CatalogMatchingService, CatalogEmbeddingsService, ImportBatchService, CatalogApprovalExecutor, ExpiredInventoryCron, LowStockCron, LostRevenueCron],
  exports: [InventoryService, ConsumptionAnalyticsService, InventoryImportService, BarcodeLookupService, BatchesService, ProductRecallService, CatalogMatchingService, ImportBatchService, TypeOrmModule],
})
export class InventoryModule {}

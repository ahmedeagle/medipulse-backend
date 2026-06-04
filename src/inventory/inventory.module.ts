import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ConsumptionAnalyticsService } from './consumption-analytics.service';
import { InventoryImportService } from './inventory-import.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import { ProductRecallService } from './product-recall.service';
import { ProductRecallController } from './product-recall.controller';
import { InventoryItem } from './entities/inventory-item.entity';
import { Product } from './entities/product.entity';
import { ConsumptionSnapshot } from './entities/consumption-snapshot.entity';
import { RegionalDemandSignal } from './entities/regional-demand-signal.entity';
import { ProductBatch } from './entities/product-batch.entity';
import { ProductRecall } from './entities/product-recall.entity';
import { NormalizationModule } from '../normalization/normalization.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryItem, Product, ConsumptionSnapshot, RegionalDemandSignal,
      ProductBatch, ProductRecall,
    ]),
    MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }),
    NormalizationModule,
  ],
  controllers: [InventoryController, ProductRecallController],
  providers: [InventoryService, ConsumptionAnalyticsService, InventoryImportService, BarcodeLookupService, ProductRecallService],
  exports: [InventoryService, ConsumptionAnalyticsService, InventoryImportService, BarcodeLookupService, ProductRecallService, TypeOrmModule],
})
export class InventoryModule {}

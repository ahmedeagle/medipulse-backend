import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { MatchProcessor } from './match.processor';
import { ImportBatchService } from './import-batch.service';
import { InventoryImportService } from './inventory-import.service';
import { CatalogMatchingService } from './catalog-matching.service';
import { CatalogEmbeddingsService } from './catalog-embeddings.service';
import { InventoryItem } from './entities/inventory-item.entity';
import { Product } from './entities/product.entity';
import { ImportBatch } from './entities/import-batch.entity';
import { ImportBatchRow } from './entities/import-batch-row.entity';
import { NormalizationModule } from '../normalization/normalization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MATCH_QUEUE } from './match.constants';

/**
 * Worker-only module — imported solely by WorkerAppModule.
 *
 * Hosts the BullMQ consumer for the catalog-matching queue and re-instantiates
 * the matcher services it needs (without the HTTP-side InventoryModule, which
 * pulls Multer + controllers we don't want in the worker process).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryItem,
      Product,
      ImportBatch,
      ImportBatchRow,
    ]),
    BullModule.registerQueue({ name: MATCH_QUEUE }),
    NormalizationModule,
    NotificationsModule,
  ],
  providers: [
    MatchProcessor,
    ImportBatchService,
    InventoryImportService,
    CatalogMatchingService,
    CatalogEmbeddingsService,
  ],
})
export class MatchWorkerModule {}

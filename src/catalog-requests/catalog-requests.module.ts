import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogRequest } from './entities/catalog-request.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Product } from '../inventory/entities/product.entity';
import { CatalogRequestsService } from './catalog-requests.service';
import { CatalogRequestsController } from './catalog-requests.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogRequest, InventoryItem, Product])],
  controllers: [CatalogRequestsController],
  providers: [CatalogRequestsService],
  exports: [CatalogRequestsService],
})
export class CatalogRequestsModule {}

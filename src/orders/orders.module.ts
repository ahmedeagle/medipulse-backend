import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { InvoiceService } from './invoice.service';
import { Invoice } from './entities/invoice.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderReturnRequest } from './entities/order-return-request.entity';
import { OrderComment } from './entities/order-comment.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { RedisModule } from '../common/redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order, OrderItem, OrderReturnRequest, OrderComment, Invoice,
      InventoryItem, SupplierCatalogItem, Tenant,
    ]),
    RedisModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, InvoiceService],
  exports: [OrdersService, InvoiceService, TypeOrmModule],
})
export class OrdersModule {}

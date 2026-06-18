import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { P2pOrder } from './entities/p2p-order.entity';
import { P2pTransferInvoice } from './entities/p2p-transfer-invoice.entity';
import { P2pDispute } from './entities/p2p-dispute.entity';
import { P2pListing } from '../p2p-listing/entities/p2p-listing.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { P2pOrdersService } from './p2p-orders.service';
import { P2pOrdersController } from './p2p-orders.controller';
import { P2pReservationCron } from './p2p-reservation.cron';
import { P2pTransferRecordService } from './p2p-transfer-record.service';
import { RedisModule } from '../common/redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      P2pOrder,
      P2pTransferInvoice,
      P2pDispute,
      P2pListing,
      InventoryItem,
    ]),
    RedisModule,
  ],
  controllers: [P2pOrdersController],
  providers: [P2pOrdersService, P2pReservationCron, P2pTransferRecordService],
  exports: [P2pOrdersService],
})
export class P2pOrdersModule {}

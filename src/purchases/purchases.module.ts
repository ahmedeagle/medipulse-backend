import { Module }             from '@nestjs/common';
import { TypeOrmModule }      from '@nestjs/typeorm';
import { PurchaseInvoice }     from './entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from './entities/purchase-invoice-line.entity';
import { PurchaseReturn }      from './entities/purchase-return.entity';
import { PurchaseReturnLine }  from './entities/purchase-return-line.entity';
import { WishListItem }        from './entities/wish-list-item.entity';
import { PurchasePriceHistory } from './entities/purchase-price-history.entity';
import { PurchasesService }    from './purchases.service';
import { PurchasesController } from './purchases.controller';
import { WishListCron }        from './wish-list.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseInvoice,
      PurchaseInvoiceLine,
      PurchaseReturn,
      PurchaseReturnLine,
      WishListItem,
      PurchasePriceHistory,
    ]),
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService, WishListCron],
  exports: [TypeOrmModule, PurchasesService],
})
export class PurchasesModule {}

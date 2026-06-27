import { Module }             from '@nestjs/common';
import { TypeOrmModule }      from '@nestjs/typeorm';
import { MulterModule }       from '@nestjs/platform-express';
import { PurchaseInvoice }     from './entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from './entities/purchase-invoice-line.entity';
import { PurchaseReturn }      from './entities/purchase-return.entity';
import { PurchaseReturnLine }  from './entities/purchase-return-line.entity';
import { WishListItem }        from './entities/wish-list-item.entity';
import { PurchasePriceHistory } from './entities/purchase-price-history.entity';
import { PurchaseInvoiceChangelog } from './entities/purchase-invoice-changelog.entity';
import { Product }             from '../inventory/entities/product.entity';
import { PurchasesService }    from './purchases.service';
import { PurchasesController } from './purchases.controller';
import { WishListCron }        from './wish-list.cron';
import { OcrService }          from './ocr.service';
import { PharmacySettingsModule } from '../pharmacy-settings/pharmacy-settings.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 8 * 1024 * 1024 } }),
    TypeOrmModule.forFeature([
      PurchaseInvoice,
      PurchaseInvoiceLine,
      PurchaseReturn,
      PurchaseReturnLine,
      WishListItem,
      PurchasePriceHistory,
      PurchaseInvoiceChangelog,
      Product,
    ]),
    PharmacySettingsModule,
    NotificationsModule,
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService, WishListCron, OcrService],
  exports: [TypeOrmModule, PurchasesService],
})
export class PurchasesModule {}

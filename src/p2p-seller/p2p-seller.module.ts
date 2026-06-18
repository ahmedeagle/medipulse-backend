import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { SellerProfile } from './entities/seller-profile.entity';
import { SellerReliabilityScore } from './entities/seller-reliability-score.entity';
import { SellerProfileService } from './seller-profile.service';
import { SellerReliabilityService } from './seller-reliability.service';
import { ExpiryProtectionService } from './expiry-protection.service';
import { ExpiryNotificationCron } from './expiry-notification.cron';
import { P2pSellerController } from './p2p-seller.controller';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { P2pListing } from '../p2p-listing/entities/p2p-listing.entity';
import { P2pOrder } from '../p2p-orders/entities/p2p-order.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PharmacySettingsModule } from '../pharmacy-settings/pharmacy-settings.module';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SellerProfile,
      SellerReliabilityScore,
      InventoryItem,
      P2pListing,
      P2pOrder,
      Tenant,
    ]),
    MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }),
    NotificationsModule,
    PharmacySettingsModule,
    CronLockModule,
  ],
  controllers: [P2pSellerController],
  providers: [SellerProfileService, SellerReliabilityService, ExpiryProtectionService, ExpiryNotificationCron],
  exports: [SellerProfileService, SellerReliabilityService, ExpiryProtectionService],
})
export class P2pSellerModule {}

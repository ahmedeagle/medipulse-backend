import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { P2pListing } from '../p2p-listing/entities/p2p-listing.entity';
import { SellerProfile } from '../p2p-seller/entities/seller-profile.entity';
import { SellerReliabilityScore } from '../p2p-seller/entities/seller-reliability-score.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { P2pMarketplaceService } from './p2p-marketplace.service';
import { P2pMarketIntelligenceService } from './p2p-market-intelligence.service';
import { P2pSmartProcurementService } from './p2p-smart-procurement.service';
import { PharmacyMatchingService } from './pharmacy-matching.service';
import { SmartProcurementCron } from './smart-procurement.cron';
import { P2pMarketplaceController } from './p2p-marketplace.controller';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { PharmacySettingsModule } from '../pharmacy-settings/pharmacy-settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      P2pListing,
      SellerProfile,
      SellerReliabilityScore,
      AiRecommendation,
      Tenant,
    ]),
    forwardRef(() => AiGovernanceModule),
    PharmacySettingsModule,
    NotificationsModule,
    CronLockModule,
  ],
  controllers: [P2pMarketplaceController],
  providers: [
    P2pMarketplaceService,
    P2pMarketIntelligenceService,
    P2pSmartProcurementService,
    PharmacyMatchingService,
    SmartProcurementCron,
  ],
  exports: [P2pMarketplaceService, P2pSmartProcurementService],
})
export class P2pMarketplaceModule {}

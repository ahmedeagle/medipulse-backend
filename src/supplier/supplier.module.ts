import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { SupplierReliabilityService } from './supplier-reliability.service';
import { SupplierProfileService } from './supplier-profile.service';
import { PreferredSupplierService } from './preferred-supplier.service';
import { CatalogImportService } from './catalog-import.service';
import { MarketAvailabilityService } from './market-availability.service';
import {
  SupplierProfileController,
  SupplierProfileAdminController,
  PreferredSupplierController,
  CatalogImportController,
  DemandSignalsController,
} from './supplier-network.controller';
import { SupplierCatalogItem } from './entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from './entities/supplier-reliability-score.entity';
import { SupplierProfile } from './entities/supplier-profile.entity';
import { PreferredSupplier } from './entities/preferred-supplier.entity';
import { MarketAvailabilitySnapshot } from './entities/market-availability-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { NormalizationModule } from '../normalization/normalization.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupplierCatalogItem,
      SupplierReliabilityScore,
      SupplierProfile,
      PreferredSupplier,
      MarketAvailabilitySnapshot,
      Tenant,
    ]),
    MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } }), // 5MB CSV max
    NormalizationModule,
    AnalyticsModule,
  ],
  controllers: [
    SupplierController,
    SupplierProfileController,
    SupplierProfileAdminController,
    PreferredSupplierController,
    CatalogImportController,
    DemandSignalsController,
  ],
  providers: [
    SupplierService,
    SupplierReliabilityService,
    SupplierProfileService,
    PreferredSupplierService,
    CatalogImportService,
    MarketAvailabilityService,
  ],
  exports: [
    SupplierService,
    SupplierReliabilityService,
    SupplierProfileService,
    PreferredSupplierService,
    MarketAvailabilityService,
  ],
})
export class SupplierModule {}

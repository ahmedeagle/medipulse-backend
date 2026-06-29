import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ForecastingController } from './forecasting.controller';
import { DemandForecastingService } from './demand-forecasting.service';
import { EoqService } from './eoq.service';
import { DemandForecast } from './entities/demand-forecast.entity';
import { ProcurementSchedule } from './entities/procurement-schedule.entity';
import { ProphetForecastComparison } from './entities/prophet-forecast-comparison.entity';
import { ProphetShadowService } from './prophet-shadow.service';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { PreferredSupplier } from '../supplier/entities/preferred-supplier.entity';
import { DeadStockService } from '../inventory/dead-stock.service';
import { DeadStockCron } from './dead-stock.cron';
import { PriceSnapshot } from '../analytics/entities/price-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PharmacySettingsModule } from '../pharmacy-settings/pharmacy-settings.module';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';

/**
 * Imported by main HTTP app.
 * Provides read APIs + manual trigger.
 * Cron jobs run in ForecastingWorkerModule (worker process).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DemandForecast,
      ProcurementSchedule,
      ConsumptionSnapshot,
      InventoryItem,
      SupplierCatalogItem,
      SupplierReliabilityScore,
      PreferredSupplier,
      PriceSnapshot,
      Tenant,
      ProphetForecastComparison,
    ]),
    NotificationsModule,
    PharmacySettingsModule,
    CronLockModule,
    forwardRef(() => AiGovernanceModule),
  ],
  controllers: [ForecastingController],
  providers: [DemandForecastingService, EoqService, DeadStockService, DeadStockCron, ProphetShadowService],
  exports: [DemandForecastingService, EoqService, DeadStockService],
})
export class ForecastingModule {}

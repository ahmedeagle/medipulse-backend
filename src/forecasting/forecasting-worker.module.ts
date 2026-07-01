import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DemandForecastingService } from './demand-forecasting.service';
import { EoqService } from './eoq.service';
import { DemandForecast } from './entities/demand-forecast.entity';
import { ProcurementSchedule } from './entities/procurement-schedule.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { PreferredSupplier } from '../supplier/entities/preferred-supplier.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { ProphetForecastComparison } from './entities/prophet-forecast-comparison.entity';
import { ProphetShadowService } from './prophet-shadow.service';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';

/**
 * Imported only by WorkerAppModule.
 * Contains the cron-driven computation jobs (no HTTP controllers).
 */
@Module({
  imports: [
    CronLockModule,
    TypeOrmModule.forFeature([
      DemandForecast,
      ProcurementSchedule,
      ConsumptionSnapshot,
      InventoryItem,
      SupplierCatalogItem,
      SupplierReliabilityScore,
      PreferredSupplier,
      Tenant,
      ProphetForecastComparison,
    ]),
  ],
  providers: [DemandForecastingService, EoqService, ProphetShadowService],
  exports: [DemandForecastingService, EoqService],
})
export class ForecastingWorkerModule {}

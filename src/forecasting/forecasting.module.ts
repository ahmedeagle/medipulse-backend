import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ForecastingController } from './forecasting.controller';
import { DemandForecastingService } from './demand-forecasting.service';
import { EoqService } from './eoq.service';
import { DemandForecast } from './entities/demand-forecast.entity';
import { ProcurementSchedule } from './entities/procurement-schedule.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { PreferredSupplier } from '../supplier/entities/preferred-supplier.entity';
import { DeadStockService } from '../inventory/dead-stock.service';
import { PriceSnapshot } from '../analytics/entities/price-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';

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
    ]),
  ],
  controllers: [ForecastingController],
  providers: [DemandForecastingService, EoqService, DeadStockService],
  exports: [DemandForecastingService, EoqService, DeadStockService],
})
export class ForecastingModule {}

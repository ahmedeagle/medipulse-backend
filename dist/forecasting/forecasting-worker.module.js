"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForecastingWorkerModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const demand_forecasting_service_1 = require("./demand-forecasting.service");
const eoq_service_1 = require("./eoq.service");
const demand_forecast_entity_1 = require("./entities/demand-forecast.entity");
const procurement_schedule_entity_1 = require("./entities/procurement-schedule.entity");
const consumption_snapshot_entity_1 = require("../inventory/entities/consumption-snapshot.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const supplier_reliability_score_entity_1 = require("../supplier/entities/supplier-reliability-score.entity");
const preferred_supplier_entity_1 = require("../supplier/entities/preferred-supplier.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
let ForecastingWorkerModule = class ForecastingWorkerModule {
};
exports.ForecastingWorkerModule = ForecastingWorkerModule;
exports.ForecastingWorkerModule = ForecastingWorkerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                demand_forecast_entity_1.DemandForecast,
                procurement_schedule_entity_1.ProcurementSchedule,
                consumption_snapshot_entity_1.ConsumptionSnapshot,
                inventory_item_entity_1.InventoryItem,
                supplier_catalog_item_entity_1.SupplierCatalogItem,
                supplier_reliability_score_entity_1.SupplierReliabilityScore,
                preferred_supplier_entity_1.PreferredSupplier,
                tenant_entity_1.Tenant,
            ]),
        ],
        providers: [demand_forecasting_service_1.DemandForecastingService, eoq_service_1.EoqService],
        exports: [demand_forecasting_service_1.DemandForecastingService, eoq_service_1.EoqService],
    })
], ForecastingWorkerModule);
//# sourceMappingURL=forecasting-worker.module.js.map
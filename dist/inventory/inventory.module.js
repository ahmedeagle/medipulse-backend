"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const platform_express_1 = require("@nestjs/platform-express");
const inventory_controller_1 = require("./inventory.controller");
const inventory_service_1 = require("./inventory.service");
const consumption_analytics_service_1 = require("./consumption-analytics.service");
const inventory_import_service_1 = require("./inventory-import.service");
const barcode_lookup_service_1 = require("./barcode-lookup.service");
const product_recall_service_1 = require("./product-recall.service");
const product_recall_controller_1 = require("./product-recall.controller");
const inventory_item_entity_1 = require("./entities/inventory-item.entity");
const product_entity_1 = require("./entities/product.entity");
const consumption_snapshot_entity_1 = require("./entities/consumption-snapshot.entity");
const regional_demand_signal_entity_1 = require("./entities/regional-demand-signal.entity");
const product_batch_entity_1 = require("./entities/product-batch.entity");
const product_recall_entity_1 = require("./entities/product-recall.entity");
const normalization_module_1 = require("../normalization/normalization.module");
let InventoryModule = class InventoryModule {
};
exports.InventoryModule = InventoryModule;
exports.InventoryModule = InventoryModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                inventory_item_entity_1.InventoryItem, product_entity_1.Product, consumption_snapshot_entity_1.ConsumptionSnapshot, regional_demand_signal_entity_1.RegionalDemandSignal,
                product_batch_entity_1.ProductBatch, product_recall_entity_1.ProductRecall,
            ]),
            platform_express_1.MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }),
            normalization_module_1.NormalizationModule,
        ],
        controllers: [inventory_controller_1.InventoryController, product_recall_controller_1.ProductRecallController],
        providers: [inventory_service_1.InventoryService, consumption_analytics_service_1.ConsumptionAnalyticsService, inventory_import_service_1.InventoryImportService, barcode_lookup_service_1.BarcodeLookupService, product_recall_service_1.ProductRecallService],
        exports: [inventory_service_1.InventoryService, consumption_analytics_service_1.ConsumptionAnalyticsService, inventory_import_service_1.InventoryImportService, barcode_lookup_service_1.BarcodeLookupService, product_recall_service_1.ProductRecallService, typeorm_1.TypeOrmModule],
    })
], InventoryModule);
//# sourceMappingURL=inventory.module.js.map
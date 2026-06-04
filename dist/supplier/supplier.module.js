"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const platform_express_1 = require("@nestjs/platform-express");
const supplier_controller_1 = require("./supplier.controller");
const supplier_service_1 = require("./supplier.service");
const supplier_reliability_service_1 = require("./supplier-reliability.service");
const supplier_profile_service_1 = require("./supplier-profile.service");
const preferred_supplier_service_1 = require("./preferred-supplier.service");
const catalog_import_service_1 = require("./catalog-import.service");
const supplier_network_controller_1 = require("./supplier-network.controller");
const supplier_catalog_item_entity_1 = require("./entities/supplier-catalog-item.entity");
const supplier_reliability_score_entity_1 = require("./entities/supplier-reliability-score.entity");
const supplier_profile_entity_1 = require("./entities/supplier-profile.entity");
const preferred_supplier_entity_1 = require("./entities/preferred-supplier.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const normalization_module_1 = require("../normalization/normalization.module");
const analytics_module_1 = require("../analytics/analytics.module");
let SupplierModule = class SupplierModule {
};
exports.SupplierModule = SupplierModule;
exports.SupplierModule = SupplierModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                supplier_catalog_item_entity_1.SupplierCatalogItem,
                supplier_reliability_score_entity_1.SupplierReliabilityScore,
                supplier_profile_entity_1.SupplierProfile,
                preferred_supplier_entity_1.PreferredSupplier,
                tenant_entity_1.Tenant,
            ]),
            platform_express_1.MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } }),
            normalization_module_1.NormalizationModule,
            analytics_module_1.AnalyticsModule,
        ],
        controllers: [
            supplier_controller_1.SupplierController,
            supplier_network_controller_1.SupplierProfileController,
            supplier_network_controller_1.SupplierProfileAdminController,
            supplier_network_controller_1.PreferredSupplierController,
            supplier_network_controller_1.CatalogImportController,
            supplier_network_controller_1.DemandSignalsController,
        ],
        providers: [
            supplier_service_1.SupplierService,
            supplier_reliability_service_1.SupplierReliabilityService,
            supplier_profile_service_1.SupplierProfileService,
            preferred_supplier_service_1.PreferredSupplierService,
            catalog_import_service_1.CatalogImportService,
        ],
        exports: [
            supplier_service_1.SupplierService,
            supplier_reliability_service_1.SupplierReliabilityService,
            supplier_profile_service_1.SupplierProfileService,
            preferred_supplier_service_1.PreferredSupplierService,
        ],
    })
], SupplierModule);
//# sourceMappingURL=supplier.module.js.map
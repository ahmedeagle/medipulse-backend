"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const domain_event_store_listener_1 = require("./domain-event-store.listener");
const price_snapshot_listener_1 = require("./price-snapshot.listener");
const recommendation_outcome_listener_1 = require("./recommendation-outcome.listener");
const analytics_read_service_1 = require("./analytics-read.service");
const analytics_controller_1 = require("./analytics.controller");
const domain_event_log_entity_1 = require("./entities/domain-event-log.entity");
const price_snapshot_entity_1 = require("./entities/price-snapshot.entity");
const weekly_analytics_snapshot_entity_1 = require("./entities/weekly-analytics-snapshot.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const supplier_profile_entity_1 = require("../supplier/entities/supplier-profile.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
let AnalyticsModule = class AnalyticsModule {
};
exports.AnalyticsModule = AnalyticsModule;
exports.AnalyticsModule = AnalyticsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([domain_event_log_entity_1.DomainEventLog], 'audit'),
            typeorm_1.TypeOrmModule.forFeature([
                price_snapshot_entity_1.PriceSnapshot,
                supplier_catalog_item_entity_1.SupplierCatalogItem,
                supplier_profile_entity_1.SupplierProfile,
                ai_recommendation_entity_1.AiRecommendation,
                inventory_item_entity_1.InventoryItem,
                weekly_analytics_snapshot_entity_1.WeeklyAnalyticsSnapshot,
                tenant_entity_1.Tenant,
            ]),
        ],
        controllers: [analytics_controller_1.AnalyticsController],
        providers: [
            domain_event_store_listener_1.DomainEventStoreListener,
            price_snapshot_listener_1.PriceSnapshotListener,
            recommendation_outcome_listener_1.RecommendationOutcomeListener,
            analytics_read_service_1.AnalyticsReadService,
        ],
        exports: [analytics_read_service_1.AnalyticsReadService],
    })
], AnalyticsModule);
//# sourceMappingURL=analytics.module.js.map
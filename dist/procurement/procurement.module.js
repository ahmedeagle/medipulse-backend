"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcurementModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const procurement_controller_1 = require("./procurement.controller");
const procurement_draft_service_1 = require("./procurement-draft.service");
const procurement_draft_listener_1 = require("./procurement-draft.listener");
const procurement_draft_entity_1 = require("./entities/procurement-draft.entity");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const supplier_reliability_score_entity_1 = require("../supplier/entities/supplier-reliability-score.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const order_entity_1 = require("../orders/entities/order.entity");
const order_item_entity_1 = require("../orders/entities/order-item.entity");
let ProcurementModule = class ProcurementModule {
};
exports.ProcurementModule = ProcurementModule;
exports.ProcurementModule = ProcurementModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                procurement_draft_entity_1.ProcurementDraft,
                ai_recommendation_entity_1.AiRecommendation,
                supplier_catalog_item_entity_1.SupplierCatalogItem,
                supplier_reliability_score_entity_1.SupplierReliabilityScore,
                inventory_item_entity_1.InventoryItem,
                order_entity_1.Order,
                order_item_entity_1.OrderItem,
            ]),
        ],
        controllers: [procurement_controller_1.ProcurementController],
        providers: [procurement_draft_service_1.ProcurementDraftService, procurement_draft_listener_1.ProcurementDraftListener],
        exports: [procurement_draft_service_1.ProcurementDraftService],
    })
], ProcurementModule);
//# sourceMappingURL=procurement.module.js.map
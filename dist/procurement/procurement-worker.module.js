"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcurementWorkerModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const auto_draft_scheduler_service_1 = require("./auto-draft-scheduler.service");
const procurement_draft_entity_1 = require("./entities/procurement-draft.entity");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const procurement_schedule_entity_1 = require("../forecasting/entities/procurement-schedule.entity");
const user_entity_1 = require("../auth/entities/user.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const notifications_module_1 = require("../notifications/notifications.module");
let ProcurementWorkerModule = class ProcurementWorkerModule {
};
exports.ProcurementWorkerModule = ProcurementWorkerModule;
exports.ProcurementWorkerModule = ProcurementWorkerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                procurement_draft_entity_1.ProcurementDraft,
                ai_recommendation_entity_1.AiRecommendation,
                supplier_catalog_item_entity_1.SupplierCatalogItem,
                procurement_schedule_entity_1.ProcurementSchedule,
                user_entity_1.User,
                tenant_entity_1.Tenant,
            ]),
            notifications_module_1.NotificationsModule,
        ],
        providers: [auto_draft_scheduler_service_1.AutoDraftSchedulerService],
    })
], ProcurementWorkerModule);
//# sourceMappingURL=procurement-worker.module.js.map
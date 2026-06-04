"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsWorkerModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const analytics_snapshot_service_1 = require("./analytics-snapshot.service");
const recommendation_outcome_listener_1 = require("./recommendation-outcome.listener");
const regional_signal_computer_service_1 = require("./regional-signal-computer.service");
const weekly_analytics_snapshot_entity_1 = require("./entities/weekly-analytics-snapshot.entity");
const domain_event_log_entity_1 = require("./entities/domain-event-log.entity");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const regional_demand_signal_entity_1 = require("../inventory/entities/regional-demand-signal.entity");
let AnalyticsWorkerModule = class AnalyticsWorkerModule {
};
exports.AnalyticsWorkerModule = AnalyticsWorkerModule;
exports.AnalyticsWorkerModule = AnalyticsWorkerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                weekly_analytics_snapshot_entity_1.WeeklyAnalyticsSnapshot,
                ai_recommendation_entity_1.AiRecommendation,
                tenant_entity_1.Tenant,
                regional_demand_signal_entity_1.RegionalDemandSignal,
            ]),
            typeorm_1.TypeOrmModule.forFeature([domain_event_log_entity_1.DomainEventLog], 'audit'),
        ],
        providers: [analytics_snapshot_service_1.AnalyticsSnapshotService, recommendation_outcome_listener_1.RecommendationOutcomeListener, regional_signal_computer_service_1.RegionalSignalComputerService],
        exports: [analytics_snapshot_service_1.AnalyticsSnapshotService, regional_signal_computer_service_1.RegionalSignalComputerService],
    })
], AnalyticsWorkerModule);
//# sourceMappingURL=analytics-worker.module.js.map
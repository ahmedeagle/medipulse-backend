"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiWorkerModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bullmq_1 = require("@nestjs/bullmq");
const ai_service_1 = require("./ai.service");
const ai_generation_processor_1 = require("./ai-generation.processor");
const recommendation_decision_trace_entity_1 = require("./entities/recommendation-decision-trace.entity");
const ai_recommendation_entity_1 = require("./entities/ai-recommendation.entity");
const ai_audit_log_entity_1 = require("./entities/ai-audit-log.entity");
const inventory_module_1 = require("../inventory/inventory.module");
const supplier_module_1 = require("../supplier/supplier.module");
const forecasting_module_1 = require("../forecasting/forecasting.module");
const order_entity_1 = require("../orders/entities/order.entity");
const order_item_entity_1 = require("../orders/entities/order-item.entity");
const rate_limiter_1 = require("./governance/rate-limiter");
const redis_module_1 = require("../common/redis/redis.module");
const ai_constants_1 = require("./ai.constants");
let AiWorkerModule = class AiWorkerModule {
};
exports.AiWorkerModule = AiWorkerModule;
exports.AiWorkerModule = AiWorkerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([ai_recommendation_entity_1.AiRecommendation, ai_audit_log_entity_1.AiAuditLog, recommendation_decision_trace_entity_1.RecommendationDecisionTrace, order_entity_1.Order, order_item_entity_1.OrderItem]),
            bullmq_1.BullModule.registerQueue({ name: ai_constants_1.AI_RECOMMENDATIONS_QUEUE }),
            inventory_module_1.InventoryModule,
            supplier_module_1.SupplierModule,
            forecasting_module_1.ForecastingModule,
            redis_module_1.RedisModule,
        ],
        providers: [ai_service_1.AiService, rate_limiter_1.AiRateLimiter, ai_generation_processor_1.AiGenerationProcessor],
    })
], AiWorkerModule);
//# sourceMappingURL=ai-worker.module.js.map
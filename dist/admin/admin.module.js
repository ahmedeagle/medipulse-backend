"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bullmq_1 = require("@nestjs/bullmq");
const admin_controller_1 = require("./admin.controller");
const admin_service_1 = require("./admin.service");
const dlq_service_1 = require("./dlq.service");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const user_entity_1 = require("../auth/entities/user.entity");
const ai_constants_1 = require("../ai/ai.constants");
const audit_constants_1 = require("../audit/audit.constants");
const webhook_constants_1 = require("../webhooks/webhook.constants");
let AdminModule = class AdminModule {
};
exports.AdminModule = AdminModule;
exports.AdminModule = AdminModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([tenant_entity_1.Tenant, user_entity_1.User]),
            bullmq_1.BullModule.registerQueue({ name: ai_constants_1.AI_RECOMMENDATIONS_QUEUE }, { name: audit_constants_1.AUDIT_QUEUE }, { name: webhook_constants_1.WEBHOOK_DELIVERY_QUEUE }),
        ],
        controllers: [admin_controller_1.AdminController],
        providers: [admin_service_1.AdminService, dlq_service_1.DlqService],
        exports: [admin_service_1.AdminService],
    })
], AdminModule);
//# sourceMappingURL=admin.module.js.map
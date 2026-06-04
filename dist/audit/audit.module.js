"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bullmq_1 = require("@nestjs/bullmq");
const core_1 = require("@nestjs/core");
const audit_interceptor_1 = require("./audit.interceptor");
const audit_read_interceptor_1 = require("./audit-read.interceptor");
const audit_service_1 = require("./audit.service");
const audit_controller_1 = require("./audit.controller");
const audit_event_entity_1 = require("./entities/audit-event.entity");
const read_access_log_entity_1 = require("./entities/read-access-log.entity");
const audit_constants_1 = require("./audit.constants");
let AuditModule = class AuditModule {
};
exports.AuditModule = AuditModule;
exports.AuditModule = AuditModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([audit_event_entity_1.AuditEvent], 'audit'),
            typeorm_1.TypeOrmModule.forFeature([read_access_log_entity_1.ReadAccessLog], 'audit'),
            bullmq_1.BullModule.registerQueue({ name: audit_constants_1.AUDIT_QUEUE }),
        ],
        controllers: [audit_controller_1.AuditController],
        providers: [
            audit_service_1.AuditService,
            { provide: core_1.APP_INTERCEPTOR, useClass: audit_interceptor_1.AuditInterceptor },
            { provide: core_1.APP_INTERCEPTOR, useClass: audit_read_interceptor_1.AuditReadInterceptor },
        ],
        exports: [audit_service_1.AuditService],
    })
], AuditModule);
//# sourceMappingURL=audit.module.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditWorkerModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bullmq_1 = require("@nestjs/bullmq");
const audit_event_processor_1 = require("./audit-event.processor");
const audit_event_entity_1 = require("./entities/audit-event.entity");
const audit_constants_1 = require("./audit.constants");
let AuditWorkerModule = class AuditWorkerModule {
};
exports.AuditWorkerModule = AuditWorkerModule;
exports.AuditWorkerModule = AuditWorkerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([audit_event_entity_1.AuditEvent], 'audit'),
            bullmq_1.BullModule.registerQueue({ name: audit_constants_1.AUDIT_QUEUE }),
        ],
        providers: [audit_event_processor_1.AuditEventProcessor],
    })
], AuditWorkerModule);
//# sourceMappingURL=audit-worker.module.js.map
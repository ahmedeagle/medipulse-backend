"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AuditEventProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditEventProcessor = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const audit_event_entity_1 = require("./entities/audit-event.entity");
const audit_constants_1 = require("./audit.constants");
let AuditEventProcessor = AuditEventProcessor_1 = class AuditEventProcessor extends bullmq_1.WorkerHost {
    constructor(auditRepo) {
        super();
        this.auditRepo = auditRepo;
        this.logger = new common_1.Logger(AuditEventProcessor_1.name);
    }
    async process(job) {
        const event = this.auditRepo.create(job.data);
        await this.auditRepo.save(event);
    }
    onFailed(job, err) {
        this.logger.error(`[audit job:${job.id}] failed: ${err.message}`);
    }
};
exports.AuditEventProcessor = AuditEventProcessor;
exports.AuditEventProcessor = AuditEventProcessor = AuditEventProcessor_1 = __decorate([
    (0, bullmq_1.Processor)(audit_constants_1.AUDIT_QUEUE, { concurrency: 25 }),
    __param(0, (0, typeorm_1.InjectRepository)(audit_event_entity_1.AuditEvent, 'audit')),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], AuditEventProcessor);
//# sourceMappingURL=audit-event.processor.js.map
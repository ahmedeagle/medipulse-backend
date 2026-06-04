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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const audit_event_entity_1 = require("./entities/audit-event.entity");
let AuditService = class AuditService {
    constructor(auditRepo) {
        this.auditRepo = auditRepo;
    }
    async query(params) {
        const qb = this.auditRepo
            .createQueryBuilder('e')
            .orderBy('e.createdAt', 'DESC')
            .take(params.limit ?? 50)
            .skip(params.offset ?? 0);
        if (params.tenantId)
            qb.andWhere('e.tenantId = :tenantId', { tenantId: params.tenantId });
        if (params.resource)
            qb.andWhere('e.resource = :resource', { resource: params.resource });
        if (params.userId)
            qb.andWhere('e.userId = :userId', { userId: params.userId });
        if (params.from)
            qb.andWhere('e.createdAt >= :from', { from: params.from });
        if (params.to)
            qb.andWhere('e.createdAt <= :to', { to: params.to });
        const [data, total] = await qb.getManyAndCount();
        return { data, total };
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(audit_event_entity_1.AuditEvent, 'audit')),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], AuditService);
//# sourceMappingURL=audit.service.js.map
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
var AuditReadInterceptor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditReadInterceptor = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const operators_1 = require("rxjs/operators");
const audit_read_decorator_1 = require("./decorators/audit-read.decorator");
const read_access_log_entity_1 = require("./entities/read-access-log.entity");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let AuditReadInterceptor = AuditReadInterceptor_1 = class AuditReadInterceptor {
    constructor(reflector, repo) {
        this.reflector = reflector;
        this.repo = repo;
        this.logger = new common_1.Logger(AuditReadInterceptor_1.name);
    }
    intercept(context, next) {
        const resource = this.reflector.getAllAndOverride(audit_read_decorator_1.AUDIT_READ_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!resource)
            return next.handle();
        const req = context.switchToHttp().getRequest();
        const user = req.user;
        return next.handle().pipe((0, operators_1.tap)(() => {
            const paramId = Object.values(req.params ?? {}).find((v) => typeof v === 'string' && UUID_RE.test(v));
            this.repo
                .save(this.repo.create({
                tenantId: user?.tenantId ?? null,
                userId: user?.id ?? null,
                resource,
                path: req.route?.path ?? req.path,
                resourceId: paramId ?? null,
                ipAddress: req.ip ?? null,
                userAgent: req.headers?.['user-agent'] ?? null,
            }))
                .catch((err) => this.logger.warn(`ReadAccessLog write failed: ${err.message}`));
        }));
    }
};
exports.AuditReadInterceptor = AuditReadInterceptor;
exports.AuditReadInterceptor = AuditReadInterceptor = AuditReadInterceptor_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_1.InjectRepository)(read_access_log_entity_1.ReadAccessLog, 'audit')),
    __metadata("design:paramtypes", [core_1.Reflector,
        typeorm_2.Repository])
], AuditReadInterceptor);
//# sourceMappingURL=audit-read.interceptor.js.map
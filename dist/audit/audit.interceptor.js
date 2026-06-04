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
var AuditInterceptor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditInterceptor = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const operators_1 = require("rxjs/operators");
const rxjs_1 = require("rxjs");
const audit_constants_1 = require("./audit.constants");
const SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIP_PATHS = ['/health', '/docs', '/admin/queues'];
function extractResource(path) {
    const segment = path.replace(/^\/api\/v\d+\//, '').split('/')[0];
    return segment || 'unknown';
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let AuditInterceptor = AuditInterceptor_1 = class AuditInterceptor {
    constructor(auditQueue) {
        this.auditQueue = auditQueue;
        this.logger = new common_1.Logger(AuditInterceptor_1.name);
    }
    intercept(context, next) {
        const req = context.switchToHttp().getRequest();
        const start = Date.now();
        if (SKIP_METHODS.has(req.method) ||
            SKIP_PATHS.some((p) => req.path?.startsWith(p))) {
            return next.handle();
        }
        const emitAudit = (statusCode, resourceId) => {
            const user = req.user;
            this.auditQueue
                .add(audit_constants_1.AUDIT_JOB, {
                tenantId: user?.tenantId ?? null,
                userId: user?.id ?? null,
                resource: extractResource(req.path),
                method: req.method,
                path: req.route?.path ?? req.path,
                statusCode,
                latencyMs: Date.now() - start,
                resourceId: resourceId ?? null,
                ipAddress: req.ip ?? null,
                userAgent: req.headers?.['user-agent'] ?? null,
            }, { removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } })
                .catch((err) => this.logger.warn(`Audit enqueue failed: ${err.message}`));
        };
        return next.handle().pipe((0, operators_1.tap)((body) => {
            const statusCode = context.switchToHttp().getResponse().statusCode;
            const resourceId = body?.id && UUID_RE.test(body.id) ? body.id : undefined;
            emitAudit(statusCode, resourceId);
        }), (0, operators_1.catchError)((err) => {
            emitAudit(err?.status ?? 500);
            return (0, rxjs_1.throwError)(() => err);
        }));
    }
};
exports.AuditInterceptor = AuditInterceptor;
exports.AuditInterceptor = AuditInterceptor = AuditInterceptor_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bullmq_1.InjectQueue)(audit_constants_1.AUDIT_QUEUE)),
    __metadata("design:paramtypes", [bullmq_2.Queue])
], AuditInterceptor);
//# sourceMappingURL=audit.interceptor.js.map
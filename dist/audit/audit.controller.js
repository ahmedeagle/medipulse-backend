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
exports.AuditController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const audit_service_1 = require("./audit.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("./decorators/audit-read.decorator");
let AuditController = class AuditController {
    constructor(auditService) {
        this.auditService = auditService;
    }
    async query(user, resource, userId, from, to, limit = 50, offset = 0) {
        const tenantId = user.role === role_enum_1.Role.SYSTEM_ADMIN ? undefined : user.tenantId;
        return this.auditService.query({
            tenantId,
            resource,
            userId,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
            limit: Math.min(limit, 200),
            offset: Math.max(offset, 0),
        });
    }
};
exports.AuditController = AuditController;
__decorate([
    (0, common_1.Get)(),
    (0, audit_read_decorator_1.AuditRead)('audit_logs'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN, role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Query audit events',
        description: 'SYSTEM_ADMIN sees all tenants. PHARMACY_ADMIN sees only their own tenant. ' +
            'Results ordered newest-first. Max 200 per page.',
    }),
    (0, swagger_1.ApiQuery)({ name: 'resource', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'userId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false, description: 'ISO 8601 datetime' }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false, description: 'ISO 8601 datetime' }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, schema: { default: 50, maximum: 200 } }),
    (0, swagger_1.ApiQuery)({ name: 'offset', required: false, schema: { default: 0 } }),
    (0, swagger_1.ApiOkResponse)({ description: '{ data: AuditEvent[], total: number }' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('resource')),
    __param(2, (0, common_1.Query)('userId')),
    __param(3, (0, common_1.Query)('from')),
    __param(4, (0, common_1.Query)('to')),
    __param(5, (0, common_1.Query)('limit', new common_1.DefaultValuePipe(50), new common_1.ParseIntPipe())),
    __param(6, (0, common_1.Query)('offset', new common_1.DefaultValuePipe(0), new common_1.ParseIntPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], AuditController.prototype, "query", null);
exports.AuditController = AuditController = __decorate([
    (0, swagger_1.ApiTags)('audit'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('audit'),
    __metadata("design:paramtypes", [audit_service_1.AuditService])
], AuditController);
//# sourceMappingURL=audit.controller.js.map
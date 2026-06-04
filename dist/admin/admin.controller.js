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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const admin_service_1 = require("./admin.service");
const dlq_service_1 = require("./dlq.service");
const create_tenant_dto_1 = require("./dto/create-tenant.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const role_enum_1 = require("../common/enums/role.enum");
let AdminController = class AdminController {
    constructor(adminService, dlqService) {
        this.adminService = adminService;
        this.dlqService = dlqService;
    }
    findAllTenants() {
        return this.adminService.findAllTenants();
    }
    createTenant(dto) {
        return this.adminService.createTenant(dto);
    }
    findAllUsers() {
        return this.adminService.findAllUsers();
    }
    deactivateUser(id) {
        return this.adminService.deactivateUser(id);
    }
    getDlq() {
        return this.dlqService.getFailedJobs();
    }
    retryDlqJob(queue, jobId) {
        return this.dlqService.retryJob(queue, jobId);
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('tenants'),
    (0, swagger_1.ApiOperation)({ summary: 'Get all tenants with their user counts (system admin only)' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Returns all tenants with user count' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "findAllTenants", null);
__decorate([
    (0, common_1.Post)('tenants'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new tenant (system admin only)' }),
    (0, swagger_1.ApiCreatedResponse)({ description: 'Tenant created successfully' }),
    (0, swagger_1.ApiConflictResponse)({ description: 'Tenant with this slug already exists' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_tenant_dto_1.CreateTenantDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "createTenant", null);
__decorate([
    (0, common_1.Get)('users'),
    (0, swagger_1.ApiOperation)({ summary: 'Get all users across all tenants (system admin only)' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Returns all users with their tenant information' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "findAllUsers", null);
__decorate([
    (0, common_1.Patch)('users/:id/deactivate'),
    (0, swagger_1.ApiOperation)({ summary: 'Deactivate a user account (system admin only)' }),
    (0, swagger_1.ApiOkResponse)({ description: 'User deactivated successfully' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'User not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "deactivateUser", null);
__decorate([
    (0, common_1.Get)('dlq'),
    (0, swagger_1.ApiOperation)({
        summary: 'View permanently failed jobs across all queues (DLQ)',
        description: 'Shows jobs that exhausted all retry attempts across ai-recommendations, audit-events, and webhook-delivery queues.',
    }),
    (0, swagger_1.ApiOkResponse)({ description: 'Failed jobs, most recent first' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getDlq", null);
__decorate([
    (0, common_1.Post)('dlq/retry'),
    (0, swagger_1.ApiOperation)({ summary: 'Retry a permanently failed job' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Job re-queued' }),
    __param(0, (0, common_1.Query)('queue')),
    __param(1, (0, common_1.Query)('jobId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "retryDlqJob", null);
exports.AdminController = AdminController = __decorate([
    (0, swagger_1.ApiTags)('admin'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, common_1.Controller)('admin'),
    __metadata("design:paramtypes", [admin_service_1.AdminService,
        dlq_service_1.DlqService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map
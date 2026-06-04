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
exports.ChainAdminController = exports.OrganizationsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const organizations_service_1 = require("./organizations.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("../audit/decorators/audit-read.decorator");
class CreateOrganizationDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateOrganizationDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateOrganizationDto.prototype, "slug", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['chain', 'hospital_network', 'group']),
    __metadata("design:type", String)
], CreateOrganizationDto.prototype, "type", void 0);
class AddBranchDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddBranchDto.prototype, "tenantId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['branch', 'central']),
    __metadata("design:type", String)
], AddBranchDto.prototype, "branchRole", void 0);
let OrganizationsController = class OrganizationsController {
    constructor(svc) {
        this.svc = svc;
    }
    create(dto) {
        return this.svc.create(dto);
    }
    findAll() {
        return this.svc.findAll();
    }
    addBranch(orgId, dto) {
        return this.svc.addBranch(orgId, dto.tenantId, dto.branchRole);
    }
    removeBranch(tenantId) {
        return this.svc.removeBranch(tenantId);
    }
};
exports.OrganizationsController = OrganizationsController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Create an organization (pharmacy chain / hospital network)' }),
    (0, swagger_1.ApiCreatedResponse)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateOrganizationDto]),
    __metadata("design:returntype", void 0)
], OrganizationsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'List all organizations (system admin)' }),
    (0, swagger_1.ApiOkResponse)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OrganizationsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(':id/branches'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Add a tenant as a branch of this organization' }),
    (0, swagger_1.ApiCreatedResponse)(),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, AddBranchDto]),
    __metadata("design:returntype", void 0)
], OrganizationsController.prototype, "addBranch", null);
__decorate([
    (0, common_1.Delete)(':id/branches/:tenantId'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Remove a tenant from this organization' }),
    __param(0, (0, common_1.Param)('tenantId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OrganizationsController.prototype, "removeBranch", null);
exports.OrganizationsController = OrganizationsController = __decorate([
    (0, swagger_1.ApiTags)('organizations'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('organizations'),
    __metadata("design:paramtypes", [organizations_service_1.OrganizationsService])
], OrganizationsController);
let ChainAdminController = class ChainAdminController {
    constructor(svc) {
        this.svc = svc;
    }
    getBranches(user) {
        return this.svc.getBranches(user.organizationId);
    }
    getAggregatedInventory(user) {
        return this.svc.getAggregatedInventory(user.organizationId);
    }
    getOrders(user) {
        return this.svc.getAggregatedOrders(user.organizationId);
    }
    getSpend(user) {
        return this.svc.getSpendAnalytics(user.organizationId);
    }
};
exports.ChainAdminController = ChainAdminController;
__decorate([
    (0, common_1.Get)('branches'),
    (0, swagger_1.ApiOperation)({ summary: 'List all branches in this chain (chain admin)' }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ChainAdminController.prototype, "getBranches", null);
__decorate([
    (0, common_1.Get)('inventory/aggregated'),
    (0, audit_read_decorator_1.AuditRead)('org_inventory'),
    (0, swagger_1.ApiOperation)({
        summary: 'Cross-branch inventory — low-stock items across all branches',
        description: 'Returns branches that have items at or below minimum threshold, ordered by quantity ascending.',
    }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ChainAdminController.prototype, "getAggregatedInventory", null);
__decorate([
    (0, common_1.Get)('orders'),
    (0, audit_read_decorator_1.AuditRead)('org_orders'),
    (0, swagger_1.ApiOperation)({ summary: 'All orders across all branches (chain admin)' }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ChainAdminController.prototype, "getOrders", null);
__decorate([
    (0, common_1.Get)('analytics/spend'),
    (0, swagger_1.ApiOperation)({
        summary: 'Spend analytics by branch — last 90 days of delivered orders',
        description: 'Shows totalSpend and orderCount per branch. Useful for central procurement reporting.',
    }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ChainAdminController.prototype, "getSpend", null);
exports.ChainAdminController = ChainAdminController = __decorate([
    (0, swagger_1.ApiTags)('organizations'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.CHAIN_ADMIN),
    (0, common_1.Controller)('org'),
    __metadata("design:paramtypes", [organizations_service_1.OrganizationsService])
], ChainAdminController);
//# sourceMappingURL=organizations.controller.js.map
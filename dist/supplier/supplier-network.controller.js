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
exports.DemandSignalsController = exports.CatalogImportController = exports.PreferredSupplierController = exports.SupplierProfileAdminController = exports.SupplierProfileController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const supplier_profile_service_1 = require("./supplier-profile.service");
const preferred_supplier_service_1 = require("./preferred-supplier.service");
const catalog_import_service_1 = require("./catalog-import.service");
const analytics_read_service_1 = require("../analytics/analytics-read.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("../audit/decorators/audit-read.decorator");
class UpsertProfileDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpsertProfileDto.prototype, "companyName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpsertProfileDto.prototype, "registrationNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpsertProfileDto.prototype, "licenseNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Date)
], UpsertProfileDto.prototype, "licenseExpiryDate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpsertProfileDto.prototype, "address", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpsertProfileDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpsertProfileDto.prototype, "website", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], UpsertProfileDto.prototype, "deliveryZones", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], UpsertProfileDto.prototype, "minOrderAmount", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], UpsertProfileDto.prototype, "maxDeliveryDays", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpsertProfileDto.prototype, "paymentTerms", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], UpsertProfileDto.prototype, "certifications", void 0);
class ConnectSupplierDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ConnectSupplierDto.prototype, "supplierTenantId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(10),
    __metadata("design:type", Number)
], ConnectSupplierDto.prototype, "priority", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ConnectSupplierDto.prototype, "notes", void 0);
class RejectProfileDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RejectProfileDto.prototype, "reason", void 0);
let SupplierProfileController = class SupplierProfileController {
    constructor(profileSvc) {
        this.profileSvc = profileSvc;
    }
    getOwn(user) {
        return this.profileSvc.getOwn(user.tenantId);
    }
    upsert(user, dto) {
        return this.profileSvc.upsert(user.tenantId, dto);
    }
    findAll() {
        return this.profileSvc.findAll('verified');
    }
    findOne(id) {
        return this.profileSvc.findById(id);
    }
};
exports.SupplierProfileController = SupplierProfileController;
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN),
    (0, audit_read_decorator_1.AuditRead)('supplier_profile'),
    (0, swagger_1.ApiOperation)({ summary: 'Get own supplier profile' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SupplierProfileController.prototype, "getOwn", null);
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Create or update own supplier profile — triggers re-verification' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, UpsertProfileDto]),
    __metadata("design:returntype", void 0)
], SupplierProfileController.prototype, "upsert", null);
__decorate([
    (0, common_1.Get)('all'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.CHAIN_ADMIN),
    (0, audit_read_decorator_1.AuditRead)('supplier_profiles'),
    (0, swagger_1.ApiOperation)({ summary: 'Browse verified supplier profiles (pharmacy / chain admin)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SupplierProfileController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':supplierTenantId'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.CHAIN_ADMIN),
    (0, audit_read_decorator_1.AuditRead)('supplier_profile'),
    (0, swagger_1.ApiOperation)({ summary: 'View a specific supplier profile' }),
    __param(0, (0, common_1.Param)('supplierTenantId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SupplierProfileController.prototype, "findOne", null);
exports.SupplierProfileController = SupplierProfileController = __decorate([
    (0, swagger_1.ApiTags)('supplier-network'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('supplier/profile'),
    __metadata("design:paramtypes", [supplier_profile_service_1.SupplierProfileService])
], SupplierProfileController);
let SupplierProfileAdminController = class SupplierProfileAdminController {
    constructor(profileSvc) {
        this.profileSvc = profileSvc;
    }
    findAll(status) {
        return this.profileSvc.findAll(status);
    }
    verify(id) {
        return this.profileSvc.verify(id);
    }
    reject(id, dto) {
        return this.profileSvc.reject(id, dto.reason);
    }
    suspend(id) {
        return this.profileSvc.suspend(id);
    }
};
exports.SupplierProfileAdminController = SupplierProfileAdminController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all supplier profiles (system admin)' }),
    __param(0, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SupplierProfileAdminController.prototype, "findAll", null);
__decorate([
    (0, common_1.Patch)(':supplierTenantId/verify'),
    (0, swagger_1.ApiOperation)({ summary: 'Verify a supplier profile — enables higher recommendation ranking' }),
    __param(0, (0, common_1.Param)('supplierTenantId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SupplierProfileAdminController.prototype, "verify", null);
__decorate([
    (0, common_1.Patch)(':supplierTenantId/reject'),
    (0, swagger_1.ApiOperation)({ summary: 'Reject a supplier profile with a reason' }),
    __param(0, (0, common_1.Param)('supplierTenantId', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, RejectProfileDto]),
    __metadata("design:returntype", void 0)
], SupplierProfileAdminController.prototype, "reject", null);
__decorate([
    (0, common_1.Patch)(':supplierTenantId/suspend'),
    (0, swagger_1.ApiOperation)({ summary: 'Suspend a supplier' }),
    __param(0, (0, common_1.Param)('supplierTenantId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SupplierProfileAdminController.prototype, "suspend", null);
exports.SupplierProfileAdminController = SupplierProfileAdminController = __decorate([
    (0, swagger_1.ApiTags)('supplier-network'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, common_1.Controller)('admin/supplier-profiles'),
    __metadata("design:paramtypes", [supplier_profile_service_1.SupplierProfileService])
], SupplierProfileAdminController);
let PreferredSupplierController = class PreferredSupplierController {
    constructor(preferredSvc) {
        this.preferredSvc = preferredSvc;
    }
    list(user) {
        return this.preferredSvc.listForPharmacy(user.tenantId);
    }
    connect(user, dto) {
        return this.preferredSvc.connect(user.tenantId, dto.supplierTenantId, dto.priority, dto.notes);
    }
    disconnect(user, sid) {
        return this.preferredSvc.disconnect(user.tenantId, sid);
    }
};
exports.PreferredSupplierController = PreferredSupplierController;
__decorate([
    (0, common_1.Get)(),
    (0, audit_read_decorator_1.AuditRead)('preferred_suppliers'),
    (0, swagger_1.ApiOperation)({ summary: 'List preferred suppliers for this pharmacy (ordered by priority)' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PreferredSupplierController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Connect with a supplier (sets preference for recommendations)' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ConnectSupplierDto]),
    __metadata("design:returntype", void 0)
], PreferredSupplierController.prototype, "connect", null);
__decorate([
    (0, common_1.Delete)(':supplierTenantId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({ summary: 'Remove supplier from preferred list' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('supplierTenantId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PreferredSupplierController.prototype, "disconnect", null);
exports.PreferredSupplierController = PreferredSupplierController = __decorate([
    (0, swagger_1.ApiTags)('supplier-network'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, common_1.Controller)('connections'),
    __metadata("design:paramtypes", [preferred_supplier_service_1.PreferredSupplierService])
], PreferredSupplierController);
let CatalogImportController = class CatalogImportController {
    constructor(importSvc) {
        this.importSvc = importSvc;
    }
    async importCsv(user, file) {
        if (!file)
            throw new Error('No file uploaded');
        return this.importSvc.importCsv(user.tenantId, file.buffer);
    }
};
exports.CatalogImportController = CatalogImportController;
__decorate([
    (0, common_1.Post)('import'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({ description: 'CSV file with headers: productName, genericName, category, unit, price, currency, stock, supplierSku' }),
    (0, swagger_1.ApiOperation)({
        summary: 'Bulk import supplier catalog from CSV',
        description: 'Returns { total, imported, skipped, unmapped, errors[] }. ' +
            'Products are auto-mapped via normalization engine. ' +
            'Unmapped items are flagged for admin review.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CatalogImportController.prototype, "importCsv", null);
exports.CatalogImportController = CatalogImportController = __decorate([
    (0, swagger_1.ApiTags)('supplier-network'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN),
    (0, common_1.Controller)('supplier/catalog'),
    __metadata("design:paramtypes", [catalog_import_service_1.CatalogImportService])
], CatalogImportController);
let DemandSignalsController = class DemandSignalsController {
    constructor(profileSvc, analyticsSvc) {
        this.profileSvc = profileSvc;
        this.analyticsSvc = analyticsSvc;
    }
    async getDemandSignals(user) {
        const profile = await this.profileSvc.getOwn(user.tenantId);
        const zones = profile?.deliveryZones ?? [];
        return this.analyticsSvc.getDemandSignalsForSupplier(user.tenantId, zones);
    }
};
exports.DemandSignalsController = DemandSignalsController;
__decorate([
    (0, common_1.Get)(),
    (0, audit_read_decorator_1.AuditRead)('demand_signals'),
    (0, swagger_1.ApiOperation)({
        summary: 'Anonymized demand signals in supplier\'s delivery zones',
        description: 'Shows which products pharmacies in your delivery zones are running low on. ' +
            'Fully anonymized — only product + severity + region + count shown, never specific pharmacies.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DemandSignalsController.prototype, "getDemandSignals", null);
exports.DemandSignalsController = DemandSignalsController = __decorate([
    (0, swagger_1.ApiTags)('supplier-network'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN),
    (0, common_1.Controller)('supplier/demand-signals'),
    __metadata("design:paramtypes", [supplier_profile_service_1.SupplierProfileService,
        analytics_read_service_1.AnalyticsReadService])
], DemandSignalsController);
//# sourceMappingURL=supplier-network.controller.js.map
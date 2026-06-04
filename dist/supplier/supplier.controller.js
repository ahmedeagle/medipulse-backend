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
exports.SupplierController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const supplier_service_1 = require("./supplier.service");
const create_catalog_item_dto_1 = require("./dto/create-catalog-item.dto");
const update_catalog_item_dto_1 = require("./dto/update-catalog-item.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("../audit/decorators/audit-read.decorator");
let SupplierController = class SupplierController {
    constructor(supplierService) {
        this.supplierService = supplierService;
    }
    getCatalog(user) {
        if (user.role === role_enum_1.Role.SUPPLIER_ADMIN) {
            return this.supplierService.findMyCatalog(user.tenantId);
        }
        return this.supplierService.findAllCatalog();
    }
    create(user, dto) {
        return this.supplierService.create(user.tenantId, dto);
    }
    update(user, id, dto) {
        return this.supplierService.update(user.tenantId, id, dto);
    }
    remove(user, id) {
        return this.supplierService.remove(user.tenantId, id);
    }
};
exports.SupplierController = SupplierController;
__decorate([
    (0, common_1.Get)('catalog'),
    (0, audit_read_decorator_1.AuditRead)('supplier_catalog'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Get supplier catalog — pharmacy admin sees all available items; supplier admin sees their own',
    }),
    (0, swagger_1.ApiOkResponse)({ description: 'Returns catalog items based on caller role' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SupplierController.prototype, "getCatalog", null);
__decorate([
    (0, common_1.Post)('catalog'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Add a product to supplier catalog with price and availability' }),
    (0, swagger_1.ApiCreatedResponse)({ description: 'Catalog item created successfully' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_catalog_item_dto_1.CreateCatalogItemDto]),
    __metadata("design:returntype", void 0)
], SupplierController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)('catalog/:id'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Update price, availability or stock for a catalog item' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Catalog item updated successfully' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Catalog item not found' }),
    (0, swagger_1.ApiForbiddenResponse)({ description: 'Item belongs to a different supplier' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_catalog_item_dto_1.UpdateCatalogItemDto]),
    __metadata("design:returntype", void 0)
], SupplierController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)('catalog/:id'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Soft-delete a catalog item' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Catalog item deleted successfully' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Catalog item not found' }),
    (0, swagger_1.ApiForbiddenResponse)({ description: 'Item belongs to a different supplier' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SupplierController.prototype, "remove", null);
exports.SupplierController = SupplierController = __decorate([
    (0, swagger_1.ApiTags)('supplier'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('supplier'),
    __metadata("design:paramtypes", [supplier_service_1.SupplierService])
], SupplierController);
//# sourceMappingURL=supplier.controller.js.map
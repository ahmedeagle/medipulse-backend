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
exports.NormalizationController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const product_normalization_service_1 = require("./product-normalization.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const role_enum_1 = require("../common/enums/role.enum");
class MapSkuDto {
}
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], MapSkuDto.prototype, "supplierTenantId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MapSkuDto.prototype, "supplierSku", void 0);
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], MapSkuDto.prototype, "canonicalProductId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MapSkuDto.prototype, "supplierName", void 0);
let NormalizationController = class NormalizationController {
    constructor(svc) {
        this.svc = svc;
    }
    getUnmapped() {
        return this.svc.getUnmappedProducts();
    }
    map(dto) {
        return this.svc.mapSupplierSku(dto.supplierTenantId, dto.supplierSku, dto.canonicalProductId, dto.supplierName);
    }
    getAliases(id) {
        return this.svc.getProductAliases(id);
    }
};
exports.NormalizationController = NormalizationController;
__decorate([
    (0, common_1.Get)('unmapped'),
    (0, swagger_1.ApiOperation)({ summary: 'List products flagged as requiring canonical mapping (system admin)' }),
    (0, swagger_1.ApiOkResponse)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], NormalizationController.prototype, "getUnmapped", null);
__decorate([
    (0, common_1.Post)('map'),
    (0, swagger_1.ApiOperation)({ summary: 'Map a supplier SKU to a canonical product (system admin)' }),
    (0, swagger_1.ApiCreatedResponse)({ description: 'Alias created or updated' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [MapSkuDto]),
    __metadata("design:returntype", void 0)
], NormalizationController.prototype, "map", null);
__decorate([
    (0, common_1.Get)('products/:id/aliases'),
    (0, swagger_1.ApiOperation)({ summary: 'List all supplier aliases for a canonical product' }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NormalizationController.prototype, "getAliases", null);
exports.NormalizationController = NormalizationController = __decorate([
    (0, swagger_1.ApiTags)('normalization'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, common_1.Controller)('normalization'),
    __metadata("design:paramtypes", [product_normalization_service_1.ProductNormalizationService])
], NormalizationController);
//# sourceMappingURL=normalization.controller.js.map
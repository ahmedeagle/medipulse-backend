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
exports.ProductRecallController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const product_recall_service_1 = require("./product-recall.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
class CreateRecallBodyDto {
}
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateRecallBodyDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateRecallBodyDto.prototype, "batchNumber", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['urgent', 'voluntary', 'market_withdrawal']),
    __metadata("design:type", String)
], CreateRecallBodyDto.prototype, "recallType", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateRecallBodyDto.prototype, "recallReferenceNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateRecallBodyDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateRecallBodyDto.prototype, "effectiveAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateRecallBodyDto.prototype, "resolutionDeadline", void 0);
let ProductRecallController = class ProductRecallController {
    constructor(recallSvc) {
        this.recallSvc = recallSvc;
    }
    findAll() {
        return this.recallSvc.findAll();
    }
    create(user, dto) {
        const recallDto = {
            productId: dto.productId,
            batchNumber: dto.batchNumber,
            recallType: dto.recallType,
            recallReferenceNumber: dto.recallReferenceNumber,
            description: dto.description,
            effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : undefined,
            resolutionDeadline: dto.resolutionDeadline ? new Date(dto.resolutionDeadline) : undefined,
            createdByUserId: user.id,
        };
        return this.recallSvc.create(recallDto);
    }
    resolve(id) {
        return this.recallSvc.resolve(id);
    }
};
exports.ProductRecallController = ProductRecallController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all product recalls (system admin)' }),
    (0, swagger_1.ApiOkResponse)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ProductRecallController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Issue a product recall (SFDA notice)',
        description: 'Creates recall record, marks all affected ProductBatch records as recalled, ' +
            'and immediately notifies all pharmacies holding the affected product/batch via ' +
            'in-app notification and email.',
    }),
    (0, swagger_1.ApiCreatedResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateRecallBodyDto]),
    __metadata("design:returntype", void 0)
], ProductRecallController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id/resolve'),
    (0, swagger_1.ApiOperation)({ summary: 'Mark a recall as resolved' }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductRecallController.prototype, "resolve", null);
exports.ProductRecallController = ProductRecallController = __decorate([
    (0, swagger_1.ApiTags)('recalls'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, common_1.Controller)('admin/recalls'),
    __metadata("design:paramtypes", [product_recall_service_1.ProductRecallService])
], ProductRecallController);
//# sourceMappingURL=product-recall.controller.js.map
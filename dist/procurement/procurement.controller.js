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
exports.ProcurementController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const procurement_draft_service_1 = require("./procurement-draft.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("../audit/decorators/audit-read.decorator");
class RejectDraftDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RejectDraftDto.prototype, "reason", void 0);
let ProcurementController = class ProcurementController {
    constructor(draftService) {
        this.draftService = draftService;
    }
    getQueue(user) {
        return this.draftService.getProcurementQueue(user.tenantId);
    }
    listDrafts(user) {
        return this.draftService.findPending(user.tenantId);
    }
    approveDraft(user, id) {
        return this.draftService.approveDraft(user.tenantId, id);
    }
    rejectDraft(user, id, dto) {
        return this.draftService.rejectDraft(user.tenantId, id, dto.reason);
    }
};
exports.ProcurementController = ProcurementController;
__decorate([
    (0, common_1.Get)('queue'),
    (0, swagger_1.ApiOperation)({
        summary: 'Smart Procurement Queue — pharmacy morning cockpit',
        description: 'Returns a prioritised view of: pending auto-drafts (urgency ordered), ' +
            'inventory items expiring within 30 days, and in-flight orders awaiting supplier action.',
    }),
    (0, swagger_1.ApiOkResponse)({ description: '{ criticalDrafts, expiringStock, pendingOrders }' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProcurementController.prototype, "getQueue", null);
__decorate([
    (0, common_1.Get)('drafts'),
    (0, audit_read_decorator_1.AuditRead)('procurement_drafts'),
    (0, swagger_1.ApiOperation)({ summary: 'List pending auto-generated procurement drafts' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Drafts ordered by urgency then creation date' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProcurementController.prototype, "listDrafts", null);
__decorate([
    (0, common_1.Post)('drafts/:id/approve'),
    (0, swagger_1.ApiOperation)({
        summary: 'One-click approve — converts draft to a real order atomically',
        description: 'Verifies supplier availability, creates Order + OrderItem in a single transaction.',
    }),
    (0, swagger_1.ApiCreatedResponse)({ description: 'Order created — same response as POST /orders' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ProcurementController.prototype, "approveDraft", null);
__decorate([
    (0, common_1.Delete)('drafts/:id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiBody)({ type: RejectDraftDto }),
    (0, swagger_1.ApiOperation)({ summary: 'Reject a draft — records reason for analytics' }),
    (0, swagger_1.ApiNoContentResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, RejectDraftDto]),
    __metadata("design:returntype", void 0)
], ProcurementController.prototype, "rejectDraft", null);
exports.ProcurementController = ProcurementController = __decorate([
    (0, swagger_1.ApiTags)('procurement'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, common_1.Controller)('procurement'),
    __metadata("design:paramtypes", [procurement_draft_service_1.ProcurementDraftService])
], ProcurementController);
//# sourceMappingURL=procurement.controller.js.map
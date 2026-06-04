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
exports.AiController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const ai_service_1 = require("./ai.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("../audit/decorators/audit-read.decorator");
class FeedbackDto {
}
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], FeedbackDto.prototype, "score", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FeedbackDto.prototype, "note", void 0);
let AiController = class AiController {
    constructor(aiService) {
        this.aiService = aiService;
    }
    getRecommendations(user) {
        return this.aiService.getRecommendations(user.tenantId);
    }
    enqueueGeneration(user) {
        return this.aiService.enqueueGeneration(user.tenantId, user.id);
    }
    getJobStatus(user, jobId) {
        return this.aiService.getJobStatus(user.tenantId, jobId);
    }
    dismiss(user, id) {
        return this.aiService.dismiss(user.tenantId, id);
    }
    submitFeedback(user, id, dto) {
        return this.aiService.submitFeedback(user.tenantId, id, dto.score, dto.note);
    }
    getAuditLogs(user) {
        return this.aiService.getAuditLogs(user.tenantId);
    }
};
exports.AiController = AiController;
__decorate([
    (0, common_1.Get)('recommendations'),
    (0, audit_read_decorator_1.AuditRead)('ai_recommendations'),
    (0, swagger_1.ApiOperation)({ summary: 'List active recommendations — ordered by risk level then date' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Returns active (non-dismissed) recommendations' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "getRecommendations", null);
__decorate([
    (0, common_1.Post)('recommendations/generate'),
    (0, swagger_1.ApiOperation)({
        summary: 'Enqueue AI recommendation generation',
        description: 'Adds a generation job to the queue and returns a jobId immediately. ' +
            'Poll GET /ai/recommendations/job/:jobId for status and results. ' +
            'Rate limited to 10 enqueues/hour per pharmacy.',
    }),
    (0, swagger_1.ApiAcceptedResponse)({ description: 'Job enqueued — returns { jobId, status: "queued" }' }),
    (0, swagger_1.ApiTooManyRequestsResponse)({ description: 'Rate limit exceeded' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "enqueueGeneration", null);
__decorate([
    (0, common_1.Get)('recommendations/job/:jobId'),
    (0, swagger_1.ApiOperation)({
        summary: 'Poll generation job status',
        description: 'Returns job state: waiting | active | completed | failed | delayed. ' +
            'When completed, includes the full recommendations array.',
    }),
    (0, swagger_1.ApiOkResponse)({ description: 'Job status and optional results' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Job not found (may have been auto-removed after retention window)' }),
    (0, swagger_1.ApiForbiddenResponse)({ description: 'Job belongs to a different pharmacy' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('jobId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "getJobStatus", null);
__decorate([
    (0, common_1.Patch)('recommendations/:id/dismiss'),
    (0, swagger_1.ApiOperation)({ summary: 'Dismiss a recommendation' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Dismissed' }),
    (0, swagger_1.ApiNotFoundResponse)(),
    (0, swagger_1.ApiForbiddenResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "dismiss", null);
__decorate([
    (0, common_1.Patch)('recommendations/:id/feedback'),
    (0, swagger_1.ApiOperation)({
        summary: 'Submit feedback on a recommendation',
        description: 'score: 1 = helpful, -1 = not helpful.',
    }),
    (0, swagger_1.ApiBody)({ type: FeedbackDto }),
    (0, swagger_1.ApiOkResponse)({ description: 'Feedback recorded' }),
    (0, swagger_1.ApiNotFoundResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FeedbackDto]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "submitFeedback", null);
__decorate([
    (0, common_1.Get)('audit-logs'),
    (0, audit_read_decorator_1.AuditRead)('ai_audit_logs'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get AI audit logs for this pharmacy (last 100)',
        description: 'Shows every generation attempt — model, tokens, latency, rules triggered, status.',
    }),
    (0, swagger_1.ApiOkResponse)({ description: 'Audit log entries' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "getAuditLogs", null);
exports.AiController = AiController = __decorate([
    (0, swagger_1.ApiTags)('ai'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, common_1.Controller)('ai'),
    __metadata("design:paramtypes", [ai_service_1.AiService])
], AiController);
//# sourceMappingURL=ai.controller.js.map
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationDecisionTrace = void 0;
const typeorm_1 = require("typeorm");
let RecommendationDecisionTrace = class RecommendationDecisionTrace {
};
exports.RecommendationDecisionTrace = RecommendationDecisionTrace;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], RecommendationDecisionTrace.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', unique: true }),
    __metadata("design:type", String)
], RecommendationDecisionTrace.prototype, "recommendationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], RecommendationDecisionTrace.prototype, "tenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: [] }),
    __metadata("design:type", Array)
], RecommendationDecisionTrace.prototype, "rulesEvaluated", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: [] }),
    __metadata("design:type", Array)
], RecommendationDecisionTrace.prototype, "supplierScoresConsidered", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], RecommendationDecisionTrace.prototype, "forecastUsed", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], RecommendationDecisionTrace.prototype, "seasonalSignal", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], RecommendationDecisionTrace.prototype, "eoqUsed", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 10 }),
    __metadata("design:type", String)
], RecommendationDecisionTrace.prototype, "finalRiskLevel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 4 }),
    __metadata("design:type", Number)
], RecommendationDecisionTrace.prototype, "confidenceScore", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 10 }),
    __metadata("design:type", String)
], RecommendationDecisionTrace.prototype, "confidenceLabel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], RecommendationDecisionTrace.prototype, "explanationFromGpt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], RecommendationDecisionTrace.prototype, "generatedAt", void 0);
exports.RecommendationDecisionTrace = RecommendationDecisionTrace = __decorate([
    (0, typeorm_1.Entity)('recommendation_decision_traces'),
    (0, typeorm_1.Index)(['recommendationId'], { unique: true }),
    (0, typeorm_1.Index)(['tenantId', 'generatedAt'])
], RecommendationDecisionTrace);
//# sourceMappingURL=recommendation-decision-trace.entity.js.map
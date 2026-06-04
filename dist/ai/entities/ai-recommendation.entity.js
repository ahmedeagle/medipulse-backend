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
exports.AiRecommendation = void 0;
const typeorm_1 = require("typeorm");
const recommendation_type_enum_1 = require("../../common/enums/recommendation-type.enum");
const tenant_entity_1 = require("../../auth/entities/tenant.entity");
const product_entity_1 = require("../../inventory/entities/product.entity");
let AiRecommendation = class AiRecommendation {
};
exports.AiRecommendation = AiRecommendation;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], AiRecommendation.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], AiRecommendation.prototype, "pharmacyTenantId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => tenant_entity_1.Tenant, { eager: false }),
    (0, typeorm_1.JoinColumn)({ name: 'pharmacyTenantId' }),
    __metadata("design:type", tenant_entity_1.Tenant)
], AiRecommendation.prototype, "pharmacyTenant", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: recommendation_type_enum_1.RecommendationType }),
    __metadata("design:type", String)
], AiRecommendation.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], AiRecommendation.prototype, "productId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => product_entity_1.Product, { eager: false, nullable: true }),
    (0, typeorm_1.JoinColumn)({ name: 'productId' }),
    __metadata("design:type", product_entity_1.Product)
], AiRecommendation.prototype, "product", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb' }),
    __metadata("design:type", Object)
], AiRecommendation.prototype, "payload", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], AiRecommendation.prototype, "explanation", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], AiRecommendation.prototype, "explanationFromGpt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 10, default: 'LOW' }),
    __metadata("design:type", String)
], AiRecommendation.prototype, "riskLevel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 4, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], AiRecommendation.prototype, "confidence", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 10, default: 'low' }),
    __metadata("design:type", String)
], AiRecommendation.prototype, "confidenceLabel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: [] }),
    __metadata("design:type", Array)
], AiRecommendation.prototype, "rulesTriggered", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], AiRecommendation.prototype, "isDismissed", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], AiRecommendation.prototype, "feedbackScore", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], AiRecommendation.prototype, "feedbackNote", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, nullable: true }),
    __metadata("design:type", String)
], AiRecommendation.prototype, "outcome", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Date)
], AiRecommendation.prototype, "outcomeAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], AiRecommendation.prototype, "createdAt", void 0);
exports.AiRecommendation = AiRecommendation = __decorate([
    (0, typeorm_1.Entity)('ai_recommendations'),
    (0, typeorm_1.Index)(['pharmacyTenantId', 'isDismissed', 'createdAt'])
], AiRecommendation);
//# sourceMappingURL=ai-recommendation.entity.js.map
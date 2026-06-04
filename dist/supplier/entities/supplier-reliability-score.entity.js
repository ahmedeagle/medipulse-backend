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
exports.SupplierReliabilityScore = void 0;
const typeorm_1 = require("typeorm");
let SupplierReliabilityScore = class SupplierReliabilityScore {
};
exports.SupplierReliabilityScore = SupplierReliabilityScore;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], SupplierReliabilityScore.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], SupplierReliabilityScore.prototype, "supplierTenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], SupplierReliabilityScore.prototype, "productId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 4, default: 0 }),
    __metadata("design:type", Number)
], SupplierReliabilityScore.prototype, "acceptanceRate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 6, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], SupplierReliabilityScore.prototype, "avgDeliveryDays", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 4, default: 0 }),
    __metadata("design:type", Number)
], SupplierReliabilityScore.prototype, "fulfillmentRate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], SupplierReliabilityScore.prototype, "sampleSize", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], SupplierReliabilityScore.prototype, "overallScore", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 10, default: 'low' }),
    __metadata("design:type", String)
], SupplierReliabilityScore.prototype, "reliabilityLabel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp' }),
    __metadata("design:type", Date)
], SupplierReliabilityScore.prototype, "lastCalculatedAt", void 0);
exports.SupplierReliabilityScore = SupplierReliabilityScore = __decorate([
    (0, typeorm_1.Entity)('supplier_reliability_scores'),
    (0, typeorm_1.Index)(['supplierTenantId', 'productId'], { unique: true }),
    (0, typeorm_1.Index)(['supplierTenantId', 'overallScore'])
], SupplierReliabilityScore);
//# sourceMappingURL=supplier-reliability-score.entity.js.map
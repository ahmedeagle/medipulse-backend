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
exports.WeeklyAnalyticsSnapshot = void 0;
const typeorm_1 = require("typeorm");
let WeeklyAnalyticsSnapshot = class WeeklyAnalyticsSnapshot {
};
exports.WeeklyAnalyticsSnapshot = WeeklyAnalyticsSnapshot;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], WeeklyAnalyticsSnapshot.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], WeeklyAnalyticsSnapshot.prototype, "tenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date' }),
    __metadata("design:type", Date)
], WeeklyAnalyticsSnapshot.prototype, "weekStart", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], WeeklyAnalyticsSnapshot.prototype, "totalOrders", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], WeeklyAnalyticsSnapshot.prototype, "totalSpend", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 10, default: 'SAR' }),
    __metadata("design:type", String)
], WeeklyAnalyticsSnapshot.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], WeeklyAnalyticsSnapshot.prototype, "recommendationsGenerated", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], WeeklyAnalyticsSnapshot.prototype, "recommendationsActedOn", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 4, default: 0 }),
    __metadata("design:type", Number)
], WeeklyAnalyticsSnapshot.prototype, "recommendationConversionRate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], WeeklyAnalyticsSnapshot.prototype, "stockoutEvents", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], WeeklyAnalyticsSnapshot.prototype, "topProductId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp' }),
    __metadata("design:type", Date)
], WeeklyAnalyticsSnapshot.prototype, "computedAt", void 0);
exports.WeeklyAnalyticsSnapshot = WeeklyAnalyticsSnapshot = __decorate([
    (0, typeorm_1.Entity)('weekly_analytics_snapshots'),
    (0, typeorm_1.Index)(['tenantId', 'weekStart'], { unique: true })
], WeeklyAnalyticsSnapshot);
//# sourceMappingURL=weekly-analytics-snapshot.entity.js.map
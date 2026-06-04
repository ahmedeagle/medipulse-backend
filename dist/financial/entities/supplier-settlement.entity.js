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
exports.SupplierSettlement = exports.SettlementStatus = void 0;
const typeorm_1 = require("typeorm");
var SettlementStatus;
(function (SettlementStatus) {
    SettlementStatus["PENDING"] = "pending";
    SettlementStatus["IN_PROGRESS"] = "in_progress";
    SettlementStatus["SETTLED"] = "settled";
    SettlementStatus["DISPUTED"] = "disputed";
})(SettlementStatus || (exports.SettlementStatus = SettlementStatus = {}));
let SupplierSettlement = class SupplierSettlement {
};
exports.SupplierSettlement = SupplierSettlement;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], SupplierSettlement.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'supplier_tenant_id' }),
    __metadata("design:type", String)
], SupplierSettlement.prototype, "supplierTenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'period_start', type: 'date' }),
    __metadata("design:type", Date)
], SupplierSettlement.prototype, "periodStart", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'period_end', type: 'date' }),
    __metadata("design:type", Date)
], SupplierSettlement.prototype, "periodEnd", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'total_gross', type: 'decimal', precision: 15, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], SupplierSettlement.prototype, "totalGross", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'total_returns', type: 'decimal', precision: 15, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], SupplierSettlement.prototype, "totalReturns", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'total_credits', type: 'decimal', precision: 15, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], SupplierSettlement.prototype, "totalCredits", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'net_amount', type: 'decimal', precision: 15, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], SupplierSettlement.prototype, "netAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 3, default: 'SAR' }),
    __metadata("design:type", String)
], SupplierSettlement.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'order_count', default: 0 }),
    __metadata("design:type", Number)
], SupplierSettlement.prototype, "orderCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'status', type: 'varchar', length: 20, default: SettlementStatus.PENDING }),
    __metadata("design:type", String)
], SupplierSettlement.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'settlement_reference', length: 100, nullable: true }),
    __metadata("design:type", String)
], SupplierSettlement.prototype, "settlementReference", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'settled_at', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], SupplierSettlement.prototype, "settledAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'approved_by', length: 64, nullable: true }),
    __metadata("design:type", String)
], SupplierSettlement.prototype, "approvedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'dispute_reason', type: 'text', nullable: true }),
    __metadata("design:type", String)
], SupplierSettlement.prototype, "disputeReason", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], SupplierSettlement.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], SupplierSettlement.prototype, "updatedAt", void 0);
exports.SupplierSettlement = SupplierSettlement = __decorate([
    (0, typeorm_1.Entity)('supplier_settlements'),
    (0, typeorm_1.Index)('ix_settlement_supplier', ['supplierTenantId', 'periodStart'])
], SupplierSettlement);
//# sourceMappingURL=supplier-settlement.entity.js.map
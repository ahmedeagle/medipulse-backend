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
exports.CreditWallet = exports.WalletStatus = void 0;
const typeorm_1 = require("typeorm");
var WalletStatus;
(function (WalletStatus) {
    WalletStatus["ACTIVE"] = "active";
    WalletStatus["SUSPENDED"] = "suspended";
    WalletStatus["REVIEW"] = "review";
    WalletStatus["CLOSED"] = "closed";
})(WalletStatus || (exports.WalletStatus = WalletStatus = {}));
let CreditWallet = class CreditWallet {
    get availableCredit() {
        return Math.max(0, Number(this.creditLimit) - Number(this.utilizedCredit));
    }
    get utilizationRate() {
        return this.creditLimit > 0 ? Number(this.utilizedCredit) / Number(this.creditLimit) : 0;
    }
};
exports.CreditWallet = CreditWallet;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], CreditWallet.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tenant_id', unique: true }),
    __metadata("design:type", String)
], CreditWallet.prototype, "tenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'credit_limit', type: 'decimal', precision: 15, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], CreditWallet.prototype, "creditLimit", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'utilized_credit', type: 'decimal', precision: 15, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], CreditWallet.prototype, "utilizedCredit", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 3, default: 'SAR' }),
    __metadata("design:type", String)
], CreditWallet.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'status', type: 'varchar', length: 20, default: WalletStatus.ACTIVE }),
    __metadata("design:type", String)
], CreditWallet.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'expires_at', type: 'date', nullable: true }),
    __metadata("design:type", Date)
], CreditWallet.prototype, "expiresAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'utilization_alert_threshold', type: 'decimal', precision: 4, scale: 2, default: 0.80 }),
    __metadata("design:type", Number)
], CreditWallet.prototype, "utilizationAlertThreshold", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'suspension_reason', type: 'text', nullable: true }),
    __metadata("design:type", String)
], CreditWallet.prototype, "suspensionReason", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'approved_by', length: 64, nullable: true }),
    __metadata("design:type", String)
], CreditWallet.prototype, "approvedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'approved_at', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], CreditWallet.prototype, "approvedAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], CreditWallet.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], CreditWallet.prototype, "updatedAt", void 0);
exports.CreditWallet = CreditWallet = __decorate([
    (0, typeorm_1.Entity)('credit_wallets'),
    (0, typeorm_1.Index)('ix_credit_wallet_tenant', ['tenantId'], { unique: true })
], CreditWallet);
//# sourceMappingURL=credit-wallet.entity.js.map
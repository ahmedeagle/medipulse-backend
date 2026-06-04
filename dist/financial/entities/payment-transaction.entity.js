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
exports.PaymentTransaction = exports.PaymentStatus = exports.PaymentMethod = void 0;
const typeorm_1 = require("typeorm");
var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["BANK_TRANSFER"] = "bank_transfer";
    PaymentMethod["CHEQUE"] = "cheque";
    PaymentMethod["CREDIT_WALLET"] = "credit_wallet";
    PaymentMethod["BNPL"] = "bnpl";
    PaymentMethod["CASH"] = "cash";
})(PaymentMethod || (exports.PaymentMethod = PaymentMethod = {}));
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["INITIATED"] = "initiated";
    PaymentStatus["PENDING"] = "pending";
    PaymentStatus["SETTLED"] = "settled";
    PaymentStatus["FAILED"] = "failed";
    PaymentStatus["REVERSED"] = "reversed";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
let PaymentTransaction = class PaymentTransaction {
};
exports.PaymentTransaction = PaymentTransaction;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'order_id' }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'pharmacy_tenant_id' }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "pharmacyTenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'supplier_tenant_id' }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "supplierTenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 15, scale: 2 }),
    __metadata("design:type", Number)
], PaymentTransaction.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 3, default: 'SAR' }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'payment_method', type: 'varchar', length: 30 }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "paymentMethod", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'status', type: 'varchar', length: 20, default: PaymentStatus.INITIATED }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reference_number', length: 100, nullable: true }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "referenceNumber", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'settled_at', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], PaymentTransaction.prototype, "settledAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'failure_reason', type: 'text', nullable: true }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "failureReason", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ledger_entry_id', nullable: true }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "ledgerEntryId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'initiated_by', length: 64 }),
    __metadata("design:type", String)
], PaymentTransaction.prototype, "initiatedBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], PaymentTransaction.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], PaymentTransaction.prototype, "updatedAt", void 0);
exports.PaymentTransaction = PaymentTransaction = __decorate([
    (0, typeorm_1.Entity)('payment_transactions'),
    (0, typeorm_1.Index)('ix_payment_order', ['orderId']),
    (0, typeorm_1.Index)('ix_payment_pharmacy', ['pharmacyTenantId', 'createdAt']),
    (0, typeorm_1.Index)('ix_payment_supplier', ['supplierTenantId', 'createdAt'])
], PaymentTransaction);
//# sourceMappingURL=payment-transaction.entity.js.map
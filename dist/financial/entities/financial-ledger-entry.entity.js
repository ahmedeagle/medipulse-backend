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
exports.FinancialLedgerEntry = exports.LedgerReferenceType = exports.AccountType = void 0;
const typeorm_1 = require("typeorm");
var AccountType;
(function (AccountType) {
    AccountType["AP"] = "ap";
    AccountType["AR"] = "ar";
    AccountType["REVENUE"] = "revenue";
    AccountType["CREDIT"] = "credit";
    AccountType["EXPENSE"] = "expense";
    AccountType["ESCROW"] = "escrow";
    AccountType["CASH"] = "cash";
})(AccountType || (exports.AccountType = AccountType = {}));
var LedgerReferenceType;
(function (LedgerReferenceType) {
    LedgerReferenceType["ORDER"] = "order";
    LedgerReferenceType["INVOICE"] = "invoice";
    LedgerReferenceType["PAYMENT"] = "payment";
    LedgerReferenceType["RETURN"] = "return";
    LedgerReferenceType["CREDIT_NOTE"] = "credit_note";
    LedgerReferenceType["ADJUSTMENT"] = "adjustment";
    LedgerReferenceType["SETTLEMENT"] = "settlement";
})(LedgerReferenceType || (exports.LedgerReferenceType = LedgerReferenceType = {}));
let FinancialLedgerEntry = class FinancialLedgerEntry {
};
exports.FinancialLedgerEntry = FinancialLedgerEntry;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tenant_id' }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "tenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'account_type', type: 'varchar', length: 20 }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "accountType", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'debit_amount', type: 'decimal', precision: 15, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], FinancialLedgerEntry.prototype, "debitAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'credit_amount', type: 'decimal', precision: 15, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], FinancialLedgerEntry.prototype, "creditAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 3, default: 'SAR' }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reference_type', type: 'varchar', length: 30 }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "referenceType", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reference_id' }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "referenceId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'entry_date', type: 'date' }),
    __metadata("design:type", Date)
], FinancialLedgerEntry.prototype, "entryDate", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reversal_of_id', nullable: true }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "reversalOfId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reversed_by_id', nullable: true }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "reversedById", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'correlation_id', length: 64, nullable: true }),
    __metadata("design:type", String)
], FinancialLedgerEntry.prototype, "correlationId", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'posted_at' }),
    __metadata("design:type", Date)
], FinancialLedgerEntry.prototype, "postedAt", void 0);
exports.FinancialLedgerEntry = FinancialLedgerEntry = __decorate([
    (0, typeorm_1.Entity)('financial_ledger_entries'),
    (0, typeorm_1.Index)('ix_ledger_tenant_date', ['tenantId', 'entryDate']),
    (0, typeorm_1.Index)('ix_ledger_reference', ['referenceType', 'referenceId']),
    (0, typeorm_1.Index)('ix_ledger_account_tenant', ['accountType', 'tenantId'])
], FinancialLedgerEntry);
//# sourceMappingURL=financial-ledger-entry.entity.js.map
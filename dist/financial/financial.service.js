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
exports.FinancialService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const financial_ledger_entry_entity_1 = require("./entities/financial-ledger-entry.entity");
const credit_wallet_entity_1 = require("./entities/credit-wallet.entity");
const payment_transaction_entity_1 = require("./entities/payment-transaction.entity");
const supplier_settlement_entity_1 = require("./entities/supplier-settlement.entity");
let FinancialService = class FinancialService {
    constructor(ledgerRepo, walletRepo, paymentRepo, settlementRepo, dataSource) {
        this.ledgerRepo = ledgerRepo;
        this.walletRepo = walletRepo;
        this.paymentRepo = paymentRepo;
        this.settlementRepo = settlementRepo;
        this.dataSource = dataSource;
    }
    async postJournal(entry, em) {
        const mgr = em ?? this.dataSource.manager;
        const now = new Date();
        const base = {
            tenantId: entry.tenantId,
            currency: entry.currency,
            referenceType: entry.referenceType,
            referenceId: entry.referenceId,
            description: entry.description,
            entryDate: now,
            correlationId: entry.correlationId ?? null,
        };
        await mgr.insert(financial_ledger_entry_entity_1.FinancialLedgerEntry, [
            { ...base, accountType: entry.debitAccount, debitAmount: entry.amount, creditAmount: null },
            { ...base, accountType: entry.creditAccount, creditAmount: entry.amount, debitAmount: null },
        ]);
    }
    async reverseEntry(originalEntryId, reason, em) {
        const mgr = em ?? this.dataSource.manager;
        const orig = await mgr.findOne(financial_ledger_entry_entity_1.FinancialLedgerEntry, { where: { id: originalEntryId } });
        if (!orig)
            throw new common_1.NotFoundException('Ledger entry not found');
        const reversal = mgr.create(financial_ledger_entry_entity_1.FinancialLedgerEntry, {
            tenantId: orig.tenantId,
            accountType: orig.accountType,
            debitAmount: orig.creditAmount,
            creditAmount: orig.debitAmount,
            currency: orig.currency,
            referenceType: orig.referenceType,
            referenceId: orig.referenceId,
            description: `REVERSAL: ${reason}`,
            entryDate: new Date(),
            reversalOfId: orig.id,
        });
        const saved = await mgr.save(financial_ledger_entry_entity_1.FinancialLedgerEntry, reversal);
        await mgr.update(financial_ledger_entry_entity_1.FinancialLedgerEntry, orig.id, { reversedById: saved.id });
    }
    async getWallet(tenantId) {
        return this.walletRepo.findOne({ where: { tenantId } });
    }
    async getOrCreateWallet(tenantId) {
        let wallet = await this.getWallet(tenantId);
        if (!wallet) {
            wallet = await this.walletRepo.save(this.walletRepo.create({ tenantId, creditLimit: 0, utilizedCredit: 0 }));
        }
        return wallet;
    }
    async debitWallet(tenantId, amount, orderId) {
        const wallet = await this.getOrCreateWallet(tenantId);
        if (wallet.status !== credit_wallet_entity_1.WalletStatus.ACTIVE) {
            throw new common_1.BadRequestException(`Credit wallet is ${wallet.status}`);
        }
        if (wallet.availableCredit < amount) {
            throw new common_1.BadRequestException(`Insufficient credit. Available: ${wallet.availableCredit} SAR, Required: ${amount} SAR`);
        }
        await this.walletRepo.increment({ tenantId }, 'utilizedCredit', amount);
        const alertThreshold = Number(wallet.creditLimit) * Number(wallet.utilizationAlertThreshold);
        if (Number(wallet.utilizedCredit) + amount >= alertThreshold) {
        }
    }
    async creditWallet(tenantId, amount) {
        await this.walletRepo.decrement({ tenantId }, 'utilizedCredit', Math.max(0, amount));
    }
    async setWalletLimit(tenantId, limitSar, approvedBy) {
        const wallet = await this.getOrCreateWallet(tenantId);
        wallet.creditLimit = limitSar;
        wallet.approvedBy = approvedBy;
        wallet.approvedAt = new Date();
        return this.walletRepo.save(wallet);
    }
    async getLedger(tenantId, from, to, page = 1, limit = 50) {
        const [items, total] = await this.ledgerRepo.findAndCount({
            where: { tenantId },
            order: { postedAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });
        return { items, total, page, limit };
    }
    async getBalance(tenantId) {
        const entries = await this.ledgerRepo.find({ where: { tenantId } });
        const balance = {};
        for (const e of entries) {
            if (!balance[e.accountType])
                balance[e.accountType] = 0;
            balance[e.accountType] += Number(e.debitAmount ?? 0) - Number(e.creditAmount ?? 0);
        }
        return balance;
    }
    async getReconciliation(orderId) {
        return this.ledgerRepo.find({
            where: { referenceType: financial_ledger_entry_entity_1.LedgerReferenceType.ORDER, referenceId: orderId },
            order: { postedAt: 'ASC' },
        });
    }
    async getSettlements(supplierTenantId) {
        return this.settlementRepo.find({
            where: { supplierTenantId },
            order: { periodStart: 'DESC' },
        });
    }
    async approveSettlement(id, approvedBy) {
        const s = await this.settlementRepo.findOne({ where: { id } });
        if (!s)
            throw new common_1.NotFoundException('Settlement not found');
        s.status = supplier_settlement_entity_1.SettlementStatus.SETTLED;
        s.settledAt = new Date();
        s.approvedBy = approvedBy;
        return this.settlementRepo.save(s);
    }
};
exports.FinancialService = FinancialService;
exports.FinancialService = FinancialService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(financial_ledger_entry_entity_1.FinancialLedgerEntry)),
    __param(1, (0, typeorm_1.InjectRepository)(credit_wallet_entity_1.CreditWallet)),
    __param(2, (0, typeorm_1.InjectRepository)(payment_transaction_entity_1.PaymentTransaction)),
    __param(3, (0, typeorm_1.InjectRepository)(supplier_settlement_entity_1.SupplierSettlement)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], FinancialService);
//# sourceMappingURL=financial.service.js.map
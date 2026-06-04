"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinancialModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const financial_ledger_entry_entity_1 = require("./entities/financial-ledger-entry.entity");
const credit_wallet_entity_1 = require("./entities/credit-wallet.entity");
const payment_transaction_entity_1 = require("./entities/payment-transaction.entity");
const supplier_settlement_entity_1 = require("./entities/supplier-settlement.entity");
const financial_service_1 = require("./financial.service");
const financial_controller_1 = require("./financial.controller");
let FinancialModule = class FinancialModule {
};
exports.FinancialModule = FinancialModule;
exports.FinancialModule = FinancialModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                financial_ledger_entry_entity_1.FinancialLedgerEntry,
                credit_wallet_entity_1.CreditWallet,
                payment_transaction_entity_1.PaymentTransaction,
                supplier_settlement_entity_1.SupplierSettlement,
            ]),
        ],
        controllers: [financial_controller_1.FinancialController],
        providers: [financial_service_1.FinancialService],
        exports: [financial_service_1.FinancialService],
    })
], FinancialModule);
//# sourceMappingURL=financial.module.js.map
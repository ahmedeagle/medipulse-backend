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
exports.FinancialController = void 0;
const common_1 = require("@nestjs/common");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const financial_service_1 = require("./financial.service");
let FinancialController = class FinancialController {
    constructor(svc) {
        this.svc = svc;
    }
    ledger(req, from, to, page = '1', limit = '50') {
        const tenantId = req.user.tenantId;
        return this.svc.getLedger(tenantId, from ? new Date(from) : new Date(Date.now() - 30 * 86400000), to ? new Date(to) : new Date(), parseInt(page, 10), parseInt(limit, 10));
    }
    balance(req) {
        return this.svc.getBalance(req.user.tenantId);
    }
    reconciliation(orderId) {
        return this.svc.getReconciliation(orderId);
    }
    getWallet(req) {
        return this.svc.getOrCreateWallet(req.user.tenantId);
    }
    setLimit(req, tenantId, limitSar) {
        return this.svc.setWalletLimit(tenantId, limitSar, req.user.sub);
    }
    getSettlements(req) {
        return this.svc.getSettlements(req.user.tenantId);
    }
    approveSettlement(id, req) {
        return this.svc.approveSettlement(id, req.user.sub);
    }
};
exports.FinancialController = FinancialController;
__decorate([
    (0, common_1.Get)('ledger'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN, role_enum_1.Role.PHARMACY_ADMIN),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('page')),
    __param(4, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object, Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "ledger", null);
__decorate([
    (0, common_1.Get)('balance'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN, role_enum_1.Role.PHARMACY_ADMIN),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "balance", null);
__decorate([
    (0, common_1.Get)('reconciliation/:orderId'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN, role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    __param(0, (0, common_1.Param)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "reconciliation", null);
__decorate([
    (0, common_1.Get)('credit-wallet'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SYSTEM_ADMIN),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "getWallet", null);
__decorate([
    (0, common_1.Patch)('credit-wallet/limit'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)('tenantId')),
    __param(2, (0, common_1.Body)('limitSar')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Number]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "setLimit", null);
__decorate([
    (0, common_1.Get)('settlements'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN, role_enum_1.Role.SYSTEM_ADMIN),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "getSettlements", null);
__decorate([
    (0, common_1.Patch)('settlements/:id/approve'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "approveSettlement", null);
exports.FinancialController = FinancialController = __decorate([
    (0, common_1.Controller)('v1/finance'),
    __metadata("design:paramtypes", [financial_service_1.FinancialService])
], FinancialController);
//# sourceMappingURL=financial.controller.js.map
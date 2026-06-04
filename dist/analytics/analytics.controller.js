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
exports.AnalyticsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const analytics_read_service_1 = require("./analytics-read.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("../audit/decorators/audit-read.decorator");
let AnalyticsController = class AnalyticsController {
    constructor(svc) {
        this.svc = svc;
    }
    getDashboard(user, weeks) {
        return this.svc.getWeeklySnapshots(user.tenantId, Math.min(weeks, 52));
    }
    getRegionalPricing(productId) {
        return this.svc.getRegionalPricing(productId);
    }
    getPriceTrend(productId, supplierTenantId, days) {
        return this.svc.getPriceTrend(supplierTenantId, productId, Math.min(days, 365));
    }
};
exports.AnalyticsController = AnalyticsController;
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, audit_read_decorator_1.AuditRead)('analytics_dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Weekly analytics snapshots for this pharmacy (last 12 weeks)' }),
    (0, swagger_1.ApiQuery)({ name: 'weeks', required: false, schema: { default: 12 } }),
    (0, swagger_1.ApiOkResponse)({ description: 'Weekly analytics snapshot array' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('weeks', new common_1.DefaultValuePipe(12), common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "getDashboard", null);
__decorate([
    (0, common_1.Get)('pricing/regional'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN, role_enum_1.Role.CHAIN_ADMIN, role_enum_1.Role.SYSTEM_ADMIN),
    (0, audit_read_decorator_1.AuditRead)('regional_pricing'),
    (0, swagger_1.ApiOperation)({
        summary: 'Current prices for a product across all suppliers with region breakdown',
        description: 'Powered by PriceSnapshot — includes 30-day price change % per supplier.',
    }),
    (0, swagger_1.ApiQuery)({ name: 'productId', required: true }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, common_1.Query)('productId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "getRegionalPricing", null);
__decorate([
    (0, common_1.Get)('pricing/trend'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN, role_enum_1.Role.CHAIN_ADMIN, role_enum_1.Role.SYSTEM_ADMIN),
    (0, audit_read_decorator_1.AuditRead)('pricing_trend'),
    (0, swagger_1.ApiOperation)({
        summary: 'Price trend for a product from a specific supplier over N days',
        description: 'Shows every price change recorded. Useful for detecting price volatility.',
    }),
    (0, swagger_1.ApiQuery)({ name: 'productId', required: true }),
    (0, swagger_1.ApiQuery)({ name: 'supplierTenantId', required: true }),
    (0, swagger_1.ApiQuery)({ name: 'days', required: false, schema: { default: 90 } }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, common_1.Query)('productId', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Query)('supplierTenantId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Query)('days', new common_1.DefaultValuePipe(90), common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Number]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "getPriceTrend", null);
exports.AnalyticsController = AnalyticsController = __decorate([
    (0, swagger_1.ApiTags)('analytics'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('analytics'),
    __metadata("design:paramtypes", [analytics_read_service_1.AnalyticsReadService])
], AnalyticsController);
//# sourceMappingURL=analytics.controller.js.map
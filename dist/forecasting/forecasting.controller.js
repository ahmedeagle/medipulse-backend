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
exports.ForecastingController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const demand_forecasting_service_1 = require("./demand-forecasting.service");
const eoq_service_1 = require("./eoq.service");
const dead_stock_service_1 = require("../inventory/dead-stock.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("../audit/decorators/audit-read.decorator");
let ForecastingController = class ForecastingController {
    constructor(forecastingSvc, eoqSvc, deadStockSvc) {
        this.forecastingSvc = forecastingSvc;
        this.eoqSvc = eoqSvc;
        this.deadStockSvc = deadStockSvc;
    }
    getDemandForecast(user, productId) {
        return this.forecastingSvc.getForecasts(user.tenantId, productId);
    }
    async getEoqSchedule(user, productId) {
        const schedules = await this.eoqSvc.getScheduleMap(user.tenantId, [productId]);
        return schedules.get(productId) ?? null;
    }
    getDeadStock(user) {
        return this.deadStockSvc.analyzeDeadStock(user.tenantId);
    }
    getDeadStockSummary(user) {
        return this.deadStockSvc.getTotalDeadStockValue(user.tenantId);
    }
    async refreshForecasts(user) {
        const [forecastCount] = await Promise.all([
            this.forecastingSvc.computeForecasts(user.tenantId),
            this.eoqSvc.refreshForPharmacy(user.tenantId),
        ]);
        return { message: 'Refresh complete', forecastsComputed: forecastCount };
    }
};
exports.ForecastingController = ForecastingController;
__decorate([
    (0, common_1.Get)('demand'),
    (0, audit_read_decorator_1.AuditRead)('demand_forecast'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get demand forecast for a product (7, 14, 30 day horizons)',
        description: 'Uses Holt-Winters Double Exponential Smoothing on weekly consumption snapshots. ' +
            'Returns forecast + confidence interval + trend direction per horizon. ' +
            'Includes retrospective MAPE accuracy where available.',
    }),
    (0, swagger_1.ApiQuery)({ name: 'productId', required: true }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('productId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ForecastingController.prototype, "getDemandForecast", null);
__decorate([
    (0, common_1.Get)('eoq'),
    (0, audit_read_decorator_1.AuditRead)('procurement_schedule'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get EOQ + procurement schedule for a product',
        description: 'Returns Economic Order Quantity, Safety Stock (95% service level), ' +
            'Reorder Point, optimal reorder-by date, and predicted stockout date. ' +
            'Lead time is dynamic — taken from the recommended supplier\'s reliability score.',
    }),
    (0, swagger_1.ApiQuery)({ name: 'productId', required: true }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('productId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ForecastingController.prototype, "getEoqSchedule", null);
__decorate([
    (0, common_1.Get)('dead-stock'),
    (0, audit_read_decorator_1.AuditRead)('dead_stock_analysis'),
    (0, swagger_1.ApiOperation)({
        summary: 'Dead stock analysis with financial impact and liquidation recommendations',
        description: 'Identifies products with 8+ weeks of zero movement. ' +
            'Calculates locked capital value per product. ' +
            'Recommends: return_to_supplier | markdown | write_off | monitor. ' +
            'Results ordered by urgency score.',
    }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ForecastingController.prototype, "getDeadStock", null);
__decorate([
    (0, common_1.Get)('dead-stock/summary'),
    (0, swagger_1.ApiOperation)({ summary: 'Total dead stock value and count for this pharmacy' }),
    (0, swagger_1.ApiOkResponse)({ description: '{ value: number, count: number }' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ForecastingController.prototype, "getDeadStockSummary", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, swagger_1.ApiOperation)({
        summary: 'Manually trigger forecast + EOQ refresh for this pharmacy',
        description: 'Normally runs automatically (forecasts: Sunday 6am, EOQ: daily 3am). Use for testing.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ForecastingController.prototype, "refreshForecasts", null);
exports.ForecastingController = ForecastingController = __decorate([
    (0, swagger_1.ApiTags)('forecasting'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, common_1.Controller)('forecasting'),
    __metadata("design:paramtypes", [demand_forecasting_service_1.DemandForecastingService,
        eoq_service_1.EoqService,
        dead_stock_service_1.DeadStockService])
], ForecastingController);
//# sourceMappingURL=forecasting.controller.js.map
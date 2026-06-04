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
var DemandForecastingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemandForecastingService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const demand_forecast_entity_1 = require("./entities/demand-forecast.entity");
const consumption_snapshot_entity_1 = require("../inventory/entities/consumption-snapshot.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const tenant_type_enum_1 = require("../common/enums/tenant-type.enum");
const ALPHA = 0.4;
const BETA = 0.15;
const Z_95 = 1.645;
const HORIZONS = [7, 14, 30];
const MIN_DATA_POINTS = 4;
let DemandForecastingService = DemandForecastingService_1 = class DemandForecastingService {
    constructor(forecastRepo, snapshotRepo, tenantRepo) {
        this.forecastRepo = forecastRepo;
        this.snapshotRepo = snapshotRepo;
        this.tenantRepo = tenantRepo;
        this.logger = new common_1.Logger(DemandForecastingService_1.name);
    }
    async computeAllForecasts() {
        this.logger.log('Demand forecast computation started');
        const pharmacies = await this.tenantRepo.find({
            where: { type: tenant_type_enum_1.TenantType.PHARMACY, isActive: true },
        });
        let computed = 0;
        for (const pharmacy of pharmacies) {
            computed += await this.computeForecasts(pharmacy.id);
        }
        this.logger.log(`Demand forecasts computed — ${computed} product-pharmacy pairs`);
    }
    async computeForecasts(tenantId) {
        const products = await this.snapshotRepo
            .createQueryBuilder('s')
            .select('DISTINCT s.productId', 'productId')
            .where('s.tenantId = :tenantId', { tenantId })
            .getRawMany();
        const weekStart = this.getLastMonday();
        let count = 0;
        for (const { productId } of products) {
            const snapshots = await this.snapshotRepo
                .createQueryBuilder('s')
                .where('s.tenantId = :tenantId', { tenantId })
                .andWhere('s.productId = :productId', { productId })
                .orderBy('s.weekStart', 'ASC')
                .take(26)
                .getMany();
            if (snapshots.length < MIN_DATA_POINTS)
                continue;
            for (const horizonDays of HORIZONS) {
                const result = this.holtsLinearForecast(snapshots, horizonDays);
                await this.upsertForecast(tenantId, productId, weekStart, horizonDays, result);
                count++;
            }
        }
        return count;
    }
    holtsLinearForecast(snapshots, horizonDays) {
        const weeklyQty = snapshots.map((s) => s.quantityConsumed);
        const n = weeklyQty.length;
        let L = weeklyQty[0];
        let T = n >= 2 ? (weeklyQty[1] - weeklyQty[0]) : 0;
        const residuals = [];
        for (let i = 1; i < n; i++) {
            const y = weeklyQty[i];
            const Lprev = L;
            L = ALPHA * y + (1 - ALPHA) * (L + T);
            T = BETA * (L - Lprev) + (1 - BETA) * T;
            residuals.push(Math.abs(y - (Lprev + T)));
        }
        const h = horizonDays / 7;
        const forecastedWeeklyQty = Math.max(0, L + h * T);
        const forecastedQty = Math.round(forecastedWeeklyQty * 10) / 10;
        const mae = residuals.length
            ? residuals.reduce((a, b) => a + b, 0) / residuals.length
            : forecastedQty * 0.2;
        const ciHalfWidth = Z_95 * mae * Math.sqrt(h);
        const avgWeeklyQty = weeklyQty.reduce((a, b) => a + b, 0) / n;
        const dailyDemand = (L + T) / 7;
        const trendMagnitude = Math.abs(T / 7);
        let trend = 'stable';
        if (T > avgWeeklyQty * 0.1 / 7)
            trend = 'increasing';
        else if (T < -avgWeeklyQty * 0.1 / 7)
            trend = 'decreasing';
        return {
            forecastedQty,
            confidenceIntervalLow: Math.max(0, Math.round((forecastedQty - ciHalfWidth) * 10) / 10),
            confidenceIntervalHigh: Math.round((forecastedQty + ciHalfWidth) * 10) / 10,
            estimatedDailyDemand: Math.round(dailyDemand * 1000) / 1000,
            trend,
            trendMagnitude: Math.round(trendMagnitude * 1000) / 1000,
            trainingDataPoints: n,
        };
    }
    async getForecasts(tenantId, productId) {
        const weekStart = this.getLastMonday();
        return this.forecastRepo
            .createQueryBuilder('f')
            .where('f.tenantId = :tenantId', { tenantId })
            .andWhere('f.productId = :productId', { productId })
            .andWhere('f.forecastDate = :weekStart', { weekStart })
            .orderBy('f.horizonDays', 'ASC')
            .getMany();
    }
    async getForecastMap(tenantId, productIds, horizonDays = 14) {
        if (!productIds.length)
            return new Map();
        const weekStart = this.getLastMonday();
        const forecasts = await this.forecastRepo
            .createQueryBuilder('f')
            .where('f.tenantId = :tenantId', { tenantId })
            .andWhere('f.productId IN (:...productIds)', { productIds })
            .andWhere('f.horizonDays = :horizonDays', { horizonDays })
            .andWhere('f.forecastDate = :weekStart', { weekStart })
            .getMany();
        return new Map(forecasts.map((f) => [f.productId, f]));
    }
    async updateAccuracy() {
        const fourWeeksAgo = new Date(Date.now() - 28 * 86_400_000);
        const oldForecasts = await this.forecastRepo
            .createQueryBuilder('f')
            .where('f.horizonDays = 14')
            .andWhere('f.actualQty IS NULL')
            .andWhere('f.forecastDate <= :cutoff', { cutoff: fourWeeksAgo })
            .take(500)
            .getMany();
        for (const forecast of oldForecasts) {
            const actual = await this.snapshotRepo
                .createQueryBuilder('s')
                .where('s.tenantId = :tenantId', { tenantId: forecast.tenantId })
                .andWhere('s.productId = :productId', { productId: forecast.productId })
                .andWhere('s.weekStart >= :from', { from: forecast.forecastDate })
                .andWhere('s.weekStart < :to', {
                to: new Date(forecast.forecastDate.getTime() + 14 * 86_400_000),
            })
                .getMany();
            if (!actual.length)
                continue;
            const actualQty = actual.reduce((s, r) => s + r.quantityConsumed, 0);
            const mapeError = forecast.forecastedQty > 0
                ? Math.abs(actualQty - Number(forecast.forecastedQty)) / Number(forecast.forecastedQty)
                : null;
            await this.forecastRepo.update(forecast.id, { actualQty, mapeError });
        }
    }
    async upsertForecast(tenantId, productId, forecastDate, horizonDays, result) {
        const existing = await this.forecastRepo.findOne({
            where: { tenantId, productId, forecastDate, horizonDays },
        });
        const payload = {
            tenantId,
            productId,
            forecastDate,
            horizonDays,
            algorithm: 'holt-winters-double',
            ...result,
        };
        if (existing) {
            await this.forecastRepo.update(existing.id, payload);
        }
        else {
            await this.forecastRepo.save(this.forecastRepo.create(payload));
        }
    }
    getLastMonday() {
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        d.setHours(0, 0, 0, 0);
        return d;
    }
};
exports.DemandForecastingService = DemandForecastingService;
__decorate([
    (0, schedule_1.Cron)('0 6 * * 0'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DemandForecastingService.prototype, "computeAllForecasts", null);
__decorate([
    (0, schedule_1.Cron)('0 7 * * 0'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DemandForecastingService.prototype, "updateAccuracy", null);
exports.DemandForecastingService = DemandForecastingService = DemandForecastingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(demand_forecast_entity_1.DemandForecast)),
    __param(1, (0, typeorm_1.InjectRepository)(consumption_snapshot_entity_1.ConsumptionSnapshot)),
    __param(2, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], DemandForecastingService);
//# sourceMappingURL=demand-forecasting.service.js.map
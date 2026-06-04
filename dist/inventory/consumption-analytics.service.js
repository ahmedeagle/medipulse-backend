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
var ConsumptionAnalyticsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsumptionAnalyticsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const consumption_snapshot_entity_1 = require("./entities/consumption-snapshot.entity");
const regional_demand_signal_entity_1 = require("./entities/regional-demand-signal.entity");
let ConsumptionAnalyticsService = ConsumptionAnalyticsService_1 = class ConsumptionAnalyticsService {
    constructor(snapshotRepo, signalRepo, dataSource) {
        this.snapshotRepo = snapshotRepo;
        this.signalRepo = signalRepo;
        this.dataSource = dataSource;
        this.logger = new common_1.Logger(ConsumptionAnalyticsService_1.name);
    }
    async computeWeeklySnapshots() {
        this.logger.log('Weekly consumption snapshot computation started');
        const lastMonday = new Date();
        lastMonday.setDate(lastMonday.getDate() - lastMonday.getDay() - 6);
        lastMonday.setHours(0, 0, 0, 0);
        const nextSunday = new Date(lastMonday);
        nextSunday.setDate(nextSunday.getDate() + 6);
        nextSunday.setHours(23, 59, 59, 999);
        const rows = await this.dataSource.query(`
      SELECT
        o."pharmacyTenantId" AS "tenantId",
        oi."productId",
        SUM(oi.quantity)   AS "totalQty",
        COUNT(DISTINCT o.id) AS "orderCount"
      FROM orders o
      JOIN order_items oi ON oi."orderId" = o.id
      WHERE o.status = 'delivered'
        AND o."updatedAt" BETWEEN $1 AND $2
      GROUP BY o."pharmacyTenantId", oi."productId"
      `, [lastMonday, nextSunday]);
        for (const row of rows) {
            const qty = parseInt(row.totalQty, 10);
            const orders = parseInt(row.orderCount, 10);
            await this.snapshotRepo.save(this.snapshotRepo.create({
                tenantId: row.tenantId,
                productId: row.productId,
                weekStart: lastMonday,
                quantityConsumed: qty,
                ordersPlaced: orders,
                avgOrderSize: orders ? qty / orders : 0,
                velocityLabel: this.classifyVelocity(qty),
            }));
        }
        this.logger.log(`Consumption snapshots computed — ${rows.length} product-tenant pairs`);
    }
    async getSnapshots(tenantId, productId, weeks = 8) {
        return this.snapshotRepo
            .createQueryBuilder('s')
            .where('s.tenantId = :tenantId', { tenantId })
            .andWhere('s.productId = :productId', { productId })
            .orderBy('s.weekStart', 'DESC')
            .take(weeks)
            .getMany();
    }
    async getRegionalMultiplier(productId, region, month) {
        const signal = await this.signalRepo.findOne({ where: { productId, region, month } });
        return signal ? Number(signal.demandMultiplier) : 1.0;
    }
    isSpiking(snapshots) {
        if (snapshots.length < 2)
            return false;
        const current = snapshots[0].quantityConsumed;
        const avg4w = snapshots.slice(1, 5).reduce((s, r) => s + r.quantityConsumed, 0) / Math.min(4, snapshots.length - 1);
        return avg4w > 0 && current > avg4w * 1.5;
    }
    classifyVelocity(weeklyQty) {
        if (weeklyQty === 0)
            return 'dead_stock';
        if (weeklyQty >= 50)
            return 'fast_mover';
        if (weeklyQty <= 5)
            return 'slow_mover';
        return 'normal';
    }
};
exports.ConsumptionAnalyticsService = ConsumptionAnalyticsService;
__decorate([
    (0, schedule_1.Cron)('0 3 * * 0'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ConsumptionAnalyticsService.prototype, "computeWeeklySnapshots", null);
exports.ConsumptionAnalyticsService = ConsumptionAnalyticsService = ConsumptionAnalyticsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(consumption_snapshot_entity_1.ConsumptionSnapshot)),
    __param(1, (0, typeorm_1.InjectRepository)(regional_demand_signal_entity_1.RegionalDemandSignal)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], ConsumptionAnalyticsService);
//# sourceMappingURL=consumption-analytics.service.js.map
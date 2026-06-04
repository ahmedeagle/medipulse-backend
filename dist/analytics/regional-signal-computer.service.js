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
var RegionalSignalComputerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegionalSignalComputerService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const regional_demand_signal_entity_1 = require("../inventory/entities/regional-demand-signal.entity");
const SMOOTHING_WEIGHT = 0.7;
const MIN_PHARMACIES = 3;
const MAX_MULTIPLIER = 2.0;
const MIN_MULTIPLIER = 0.5;
let RegionalSignalComputerService = RegionalSignalComputerService_1 = class RegionalSignalComputerService {
    constructor(signalRepo, dataSource) {
        this.signalRepo = signalRepo;
        this.dataSource = dataSource;
        this.logger = new common_1.Logger(RegionalSignalComputerService_1.name);
    }
    async computeAllSignals() {
        this.logger.log('Regional demand signal computation started');
        const currentMonth = new Date().getMonth() + 1;
        const count = await this.computeForMonth(currentMonth);
        this.logger.log(`Regional signals computed — ${count} product-region pairs updated`);
    }
    async computeForMonth(month) {
        const rows = await this.dataSource.query(`
      SELECT
        oi."productId",
        t.region,
        COUNT(DISTINCT o."pharmacyTenantId") AS "pharmacyCount",
        SUM(oi.quantity)                      AS "totalQty"
      FROM order_items oi
      JOIN orders o    ON o.id = oi."orderId"
      JOIN tenants t   ON t.id = o."pharmacyTenantId"
      WHERE o.status = 'delivered'
        AND EXTRACT(MONTH FROM o."updatedAt") = $1
        AND t.region IS NOT NULL
        AND t.region != ''
      GROUP BY oi."productId", t.region
      HAVING COUNT(DISTINCT o."pharmacyTenantId") >= $2
      `, [month, MIN_PHARMACIES]);
        if (!rows.length)
            return 0;
        const baseline = await this.dataSource.query(`
        SELECT
          oi."productId",
          AVG(monthly_qty) AS "avgMonthlyQty"
        FROM (
          SELECT
            oi."productId",
            EXTRACT(YEAR FROM o."updatedAt")  AS yr,
            EXTRACT(MONTH FROM o."updatedAt") AS mo,
            SUM(oi.quantity)                  AS monthly_qty
          FROM order_items oi
          JOIN orders o ON o.id = oi."orderId"
          WHERE o.status = 'delivered'
          GROUP BY oi."productId", yr, mo
        ) sub
        GROUP BY oi."productId"
        `, []);
        const baselineMap = new Map(baseline.map((b) => [
            b.productId,
            parseFloat(b.avgMonthlyQty),
        ]));
        let updated = 0;
        for (const row of rows) {
            const baseline = baselineMap.get(row.productId);
            if (!baseline || baseline === 0)
                continue;
            const computed = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, parseFloat(row.totalQty) / baseline));
            const existing = await this.signalRepo.findOne({
                where: { productId: row.productId, region: row.region, month },
            });
            const smoothed = existing
                ? SMOOTHING_WEIGHT * computed + (1 - SMOOTHING_WEIGHT) * Number(existing.demandMultiplier)
                : computed;
            const finalMultiplier = Math.round(smoothed * 1000) / 1000;
            if (existing) {
                await this.signalRepo.update(existing.id, {
                    demandMultiplier: finalMultiplier,
                    source: 'computed',
                });
            }
            else {
                await this.signalRepo.save(this.signalRepo.create({
                    productId: row.productId,
                    region: row.region,
                    month,
                    demandMultiplier: finalMultiplier,
                    source: 'computed',
                    notes: `Computed from ${row.pharmacyCount} pharmacies`,
                }));
            }
            updated++;
        }
        return updated;
    }
    async getMultiplier(productId, region, month) {
        if (!region)
            return 1.0;
        const signal = await this.signalRepo.findOne({ where: { productId, region, month } });
        return signal ? Number(signal.demandMultiplier) : 1.0;
    }
};
exports.RegionalSignalComputerService = RegionalSignalComputerService;
__decorate([
    (0, schedule_1.Cron)('0 5 1 * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RegionalSignalComputerService.prototype, "computeAllSignals", null);
exports.RegionalSignalComputerService = RegionalSignalComputerService = RegionalSignalComputerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(regional_demand_signal_entity_1.RegionalDemandSignal)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.DataSource])
], RegionalSignalComputerService);
//# sourceMappingURL=regional-signal-computer.service.js.map
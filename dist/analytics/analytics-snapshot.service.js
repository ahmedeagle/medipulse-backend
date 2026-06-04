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
var AnalyticsSnapshotService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsSnapshotService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const weekly_analytics_snapshot_entity_1 = require("./entities/weekly-analytics-snapshot.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const tenant_type_enum_1 = require("../common/enums/tenant-type.enum");
let AnalyticsSnapshotService = AnalyticsSnapshotService_1 = class AnalyticsSnapshotService {
    constructor(snapshotRepo, tenantRepo, dataSource) {
        this.snapshotRepo = snapshotRepo;
        this.tenantRepo = tenantRepo;
        this.dataSource = dataSource;
        this.logger = new common_1.Logger(AnalyticsSnapshotService_1.name);
    }
    async computeWeeklySnapshots() {
        this.logger.log('Weekly analytics snapshot computation started');
        const lastMonday = new Date();
        lastMonday.setDate(lastMonday.getDate() - lastMonday.getDay() - 6);
        lastMonday.setHours(0, 0, 0, 0);
        const nextSunday = new Date(lastMonday);
        nextSunday.setDate(nextSunday.getDate() + 6);
        nextSunday.setHours(23, 59, 59, 999);
        const pharmacies = await this.tenantRepo.find({
            where: { type: tenant_type_enum_1.TenantType.PHARMACY, isActive: true },
        });
        let computed = 0;
        for (const pharmacy of pharmacies) {
            try {
                await this.computeForTenant(pharmacy.id, lastMonday, nextSunday);
                computed++;
            }
            catch (err) {
                this.logger.error(`Snapshot failed for tenant ${pharmacy.id}: ${err.message}`);
            }
        }
        this.logger.log(`Weekly analytics complete — ${computed}/${pharmacies.length} tenants`);
    }
    async computeForTenant(tenantId, weekStart, weekEnd) {
        const [orderStats] = await this.dataSource.query(`
      SELECT
        COUNT(DISTINCT o.id)   AS "totalOrders",
        COALESCE(SUM(o."totalAmount"), 0) AS "totalSpend",
        (
          SELECT oi."productId"
          FROM order_items oi
          JOIN orders o2 ON o2.id = oi."orderId"
          WHERE o2."pharmacyTenantId" = $1
            AND o2.status = 'delivered'
            AND o2."updatedAt" BETWEEN $2 AND $3
          GROUP BY oi."productId"
          ORDER BY SUM(oi.quantity) DESC
          LIMIT 1
        ) AS "topProductId"
      FROM orders o
      WHERE o."pharmacyTenantId" = $1
        AND o.status = 'delivered'
        AND o."updatedAt" BETWEEN $2 AND $3
      `, [tenantId, weekStart, weekEnd]);
        const [recStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" BETWEEN $2 AND $3) AS "generated",
        COUNT(*) FILTER (WHERE outcome = 'acted_on' AND "outcomeAt" BETWEEN $2 AND $3) AS "acted_on"
      FROM ai_recommendations
      WHERE "pharmacyTenantId" = $1
        AND "riskLevel" = 'HIGH'
        AND type = 'reorder'
      `, [tenantId, weekStart, weekEnd]);
        const generated = parseInt(recStats?.generated ?? '0', 10);
        const actedOn = parseInt(recStats?.acted_on ?? '0', 10);
        const totalOrders = parseInt(orderStats?.totalOrders ?? '0', 10);
        const totalSpend = parseFloat(orderStats?.totalSpend ?? '0');
        const conversionRate = generated > 0 ? actedOn / generated : 0;
        const existing = await this.snapshotRepo.findOne({ where: { tenantId, weekStart } });
        const payload = {
            tenantId,
            weekStart,
            totalOrders,
            totalSpend,
            currency: 'SAR',
            recommendationsGenerated: generated,
            recommendationsActedOn: actedOn,
            recommendationConversionRate: conversionRate,
            stockoutEvents: 0,
            topProductId: orderStats?.topProductId ?? null,
            computedAt: new Date(),
        };
        if (existing) {
            await this.snapshotRepo.update(existing.id, payload);
        }
        else {
            await this.snapshotRepo.save(this.snapshotRepo.create(payload));
        }
    }
    async getSnapshots(tenantId, weeks = 12) {
        return this.snapshotRepo
            .createQueryBuilder('s')
            .where('s.tenantId = :tenantId', { tenantId })
            .orderBy('s.weekStart', 'DESC')
            .take(weeks)
            .getMany();
    }
};
exports.AnalyticsSnapshotService = AnalyticsSnapshotService;
__decorate([
    (0, schedule_1.Cron)('0 4 * * 0'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AnalyticsSnapshotService.prototype, "computeWeeklySnapshots", null);
exports.AnalyticsSnapshotService = AnalyticsSnapshotService = AnalyticsSnapshotService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(weekly_analytics_snapshot_entity_1.WeeklyAnalyticsSnapshot)),
    __param(1, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], AnalyticsSnapshotService);
//# sourceMappingURL=analytics-snapshot.service.js.map
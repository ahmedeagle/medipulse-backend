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
var SupplierReliabilityService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierReliabilityService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const supplier_reliability_score_entity_1 = require("./entities/supplier-reliability-score.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const tenant_type_enum_1 = require("../common/enums/tenant-type.enum");
const order_status_enum_1 = require("../common/enums/order-status.enum");
let SupplierReliabilityService = SupplierReliabilityService_1 = class SupplierReliabilityService {
    constructor(scoreRepo, tenantRepo, dataSource) {
        this.scoreRepo = scoreRepo;
        this.tenantRepo = tenantRepo;
        this.dataSource = dataSource;
        this.logger = new common_1.Logger(SupplierReliabilityService_1.name);
    }
    async recalculateAll() {
        this.logger.log('Supplier reliability scoring started');
        const suppliers = await this.tenantRepo.find({
            where: { type: tenant_type_enum_1.TenantType.SUPPLIER, isActive: true },
        });
        for (const supplier of suppliers) {
            try {
                await this.calculateScore(supplier.id);
            }
            catch (err) {
                this.logger.error(`Scoring failed for supplier ${supplier.id}: ${err.message}`);
            }
        }
        this.logger.log(`Supplier reliability scoring complete — ${suppliers.length} suppliers scored`);
    }
    async calculateScore(supplierTenantId) {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
        const rows = await this.dataSource.query(`
      SELECT
        o.status,
        MIN(CASE WHEN o.status IN ('accepted','shipped','delivered') THEN o."updatedAt" END) AS "acceptedAt",
        MAX(CASE WHEN o.status = 'delivered' THEN o."updatedAt" END) AS "deliveredAt"
      FROM orders o
      WHERE o."supplierTenantId" = $1
        AND o."createdAt" >= $2
      GROUP BY o.id, o.status
      `, [supplierTenantId, ninetyDaysAgo]);
        const total = rows.length;
        if (total === 0) {
            return this.upsertScore(supplierTenantId, null, {
                acceptanceRate: 0,
                avgDeliveryDays: 0,
                fulfillmentRate: 0,
                sampleSize: 0,
            });
        }
        const accepted = rows.filter((r) => r.status !== order_status_enum_1.OrderStatus.CANCELLED).length;
        const delivered = rows.filter((r) => r.status === order_status_enum_1.OrderStatus.DELIVERED).length;
        const deliveryTimes = rows
            .filter((r) => r.acceptedAt && r.deliveredAt)
            .map((r) => (new Date(r.deliveredAt).getTime() - new Date(r.acceptedAt).getTime()) / 86_400_000);
        const avgDeliveryDays = deliveryTimes.length
            ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length
            : 0;
        return this.upsertScore(supplierTenantId, null, {
            acceptanceRate: accepted / total,
            avgDeliveryDays,
            fulfillmentRate: delivered / total,
            sampleSize: total,
        });
    }
    async getScore(supplierTenantId) {
        return this.scoreRepo.findOne({ where: { supplierTenantId, productId: null } });
    }
    async getScores(supplierTenantIds) {
        if (!supplierTenantIds.length)
            return new Map();
        const scores = await this.scoreRepo
            .createQueryBuilder('s')
            .where('s.supplierTenantId IN (:...ids)', { ids: supplierTenantIds })
            .andWhere('s.productId IS NULL')
            .getMany();
        return new Map(scores.map((s) => [s.supplierTenantId, s]));
    }
    async upsertScore(supplierTenantId, productId, data) {
        const deliverySpeedScore = Math.max(0, 1 - data.avgDeliveryDays / 14);
        const overallScore = Math.round((data.acceptanceRate * 40 + data.fulfillmentRate * 40 + deliverySpeedScore * 20));
        const reliabilityLabel = overallScore >= 70 ? 'high' : overallScore >= 40 ? 'medium' : 'low';
        const existing = await this.scoreRepo.findOne({
            where: { supplierTenantId, productId: productId ?? null },
        });
        const payload = {
            ...data,
            overallScore,
            reliabilityLabel,
            lastCalculatedAt: new Date(),
        };
        if (existing) {
            await this.scoreRepo.update(existing.id, payload);
            return this.scoreRepo.findOne({ where: { id: existing.id } });
        }
        return this.scoreRepo.save(this.scoreRepo.create({ supplierTenantId, productId, ...payload }));
    }
};
exports.SupplierReliabilityService = SupplierReliabilityService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_2AM),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SupplierReliabilityService.prototype, "recalculateAll", null);
exports.SupplierReliabilityService = SupplierReliabilityService = SupplierReliabilityService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(supplier_reliability_score_entity_1.SupplierReliabilityScore)),
    __param(1, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], SupplierReliabilityService);
//# sourceMappingURL=supplier-reliability.service.js.map
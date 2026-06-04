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
exports.EoqService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const procurement_schedule_entity_1 = require("./entities/procurement-schedule.entity");
const consumption_snapshot_entity_1 = require("../inventory/entities/consumption-snapshot.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const supplier_reliability_score_entity_1 = require("../supplier/entities/supplier-reliability-score.entity");
const preferred_supplier_entity_1 = require("../supplier/entities/preferred-supplier.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const tenant_type_enum_1 = require("../common/enums/tenant-type.enum");
const ORDERING_COST_SAR = 50;
const HOLDING_COST_RATE = 0.15;
const SERVICE_LEVEL_Z = 1.645;
const DEFAULT_LEAD_DAYS = 14;
let EoqService = class EoqService {
    constructor(scheduleRepo, snapshotRepo, inventoryRepo, catalogRepo, scoreRepo, preferredRepo, tenantRepo) {
        this.scheduleRepo = scheduleRepo;
        this.snapshotRepo = snapshotRepo;
        this.inventoryRepo = inventoryRepo;
        this.catalogRepo = catalogRepo;
        this.scoreRepo = scoreRepo;
        this.preferredRepo = preferredRepo;
        this.tenantRepo = tenantRepo;
    }
    async refreshAllSchedules() {
        const pharmacies = await this.tenantRepo.find({
            where: { type: tenant_type_enum_1.TenantType.PHARMACY, isActive: true },
        });
        for (const pharmacy of pharmacies) {
            await this.refreshForPharmacy(pharmacy.id).catch(() => { });
        }
    }
    async refreshForPharmacy(tenantId) {
        const inventoryItems = await this.inventoryRepo
            .createQueryBuilder('i')
            .where('i.pharmacyTenantId = :tenantId', { tenantId })
            .andWhere('i.deletedAt IS NULL')
            .getMany();
        for (const item of inventoryItems) {
            const result = await this.calculateEoq(tenantId, item.productId, item.quantity);
            await this.upsertSchedule(tenantId, item.productId, result);
        }
    }
    async calculateEoq(tenantId, productId, currentQuantity) {
        const snapshots = await this.snapshotRepo
            .createQueryBuilder('s')
            .where('s.tenantId = :tenantId', { tenantId })
            .andWhere('s.productId = :productId', { productId })
            .orderBy('s.weekStart', 'DESC')
            .take(12)
            .getMany();
        const weeklyQtys = snapshots.map((s) => s.quantityConsumed);
        const avgWeekly = weeklyQtys.length
            ? weeklyQtys.reduce((a, b) => a + b, 0) / weeklyQtys.length
            : 0;
        const avgDaily = avgWeekly / 7;
        const annualDemand = avgDaily * 365;
        const variance = weeklyQtys.length >= 2
            ? weeklyQtys.reduce((s, q) => s + Math.pow(q - avgWeekly, 2), 0) / weeklyQtys.length
            : Math.pow(avgWeekly * 0.2, 2);
        const stdDevDaily = Math.sqrt(variance) / 7;
        const { supplierTenantId, leadDays, unitPrice } = await this.getBestSupplier(tenantId, productId);
        const holdingCostPerUnit = unitPrice * HOLDING_COST_RATE;
        const eoqQty = holdingCostPerUnit > 0 && annualDemand > 0
            ? Math.ceil(Math.sqrt((2 * annualDemand * ORDERING_COST_SAR) / holdingCostPerUnit))
            : Math.max(10, Math.ceil(avgWeekly * 2));
        const safetyStockQty = Math.ceil(SERVICE_LEVEL_Z * stdDevDaily * Math.sqrt(leadDays));
        const reorderPoint = Math.ceil((avgDaily * leadDays) + safetyStockQty);
        const now = Date.now();
        let reorderByDate;
        let predictedStockoutDate;
        let daysUntilReorderNeeded;
        if (avgDaily > 0) {
            const daysOfStock = currentQuantity / avgDaily;
            predictedStockoutDate = new Date(now + daysOfStock * 86_400_000);
            const daysUntilRop = currentQuantity > reorderPoint
                ? (currentQuantity - reorderPoint) / avgDaily
                : 0;
            reorderByDate = new Date(now + daysUntilRop * 86_400_000);
            daysUntilReorderNeeded = Math.max(0, Math.floor(daysUntilRop));
        }
        return {
            eoqQty: Math.max(1, eoqQty),
            safetyStockQty: Math.max(0, safetyStockQty),
            reorderPoint: Math.max(0, reorderPoint),
            effectiveLeadTimeDays: leadDays,
            recommendedSupplierTenantId: supplierTenantId,
            reorderByDate,
            predictedStockoutDate,
            daysUntilReorderNeeded,
        };
    }
    async getScheduleMap(tenantId, productIds) {
        if (!productIds.length)
            return new Map();
        const schedules = await this.scheduleRepo
            .createQueryBuilder('s')
            .where('s.tenantId = :tenantId', { tenantId })
            .andWhere('s.productId IN (:...productIds)', { productIds })
            .getMany();
        return new Map(schedules.map((s) => [s.productId, s]));
    }
    async getBestSupplier(tenantId, productId) {
        const listings = await this.catalogRepo
            .createQueryBuilder('c')
            .where('c.productId = :productId', { productId })
            .andWhere('c.isAvailable = true')
            .andWhere('c.deletedAt IS NULL')
            .getMany();
        if (!listings.length) {
            return { supplierTenantId: undefined, leadDays: DEFAULT_LEAD_DAYS, unitPrice: 0 };
        }
        const preferred = await this.preferredRepo
            .find({ where: { pharmacyTenantId: tenantId } });
        const preferredMap = new Map(preferred.map((p) => [p.supplierTenantId, p.priority]));
        const scores = await this.scoreRepo.find({
            where: listings.map((l) => ({ supplierTenantId: l.supplierTenantId })),
        });
        const scoreMap = new Map(scores.map((s) => [s.supplierTenantId, s]));
        const maxPrice = Math.max(...listings.map((l) => Number(l.price)));
        const minPrice = Math.min(...listings.map((l) => Number(l.price)));
        const priceRange = maxPrice - minPrice || 1;
        const ranked = listings.map((l) => {
            const prefPriority = preferredMap.has(l.supplierTenantId)
                ? (11 - (preferredMap.get(l.supplierTenantId) ?? 10)) * 5
                : 0;
            const reliabilityScore = Number(scoreMap.get(l.supplierTenantId)?.overallScore ?? 50);
            const priceScore = ((maxPrice - Number(l.price)) / priceRange) * 20;
            const totalScore = prefPriority + reliabilityScore * 0.30 + priceScore;
            return { listing: l, score: totalScore };
        });
        ranked.sort((a, b) => b.score - a.score);
        const best = ranked[0].listing;
        const bestScore = scoreMap.get(best.supplierTenantId);
        const leadDays = bestScore?.avgDeliveryDays
            ? Math.ceil(Number(bestScore.avgDeliveryDays) * 1.2)
            : DEFAULT_LEAD_DAYS;
        return {
            supplierTenantId: best.supplierTenantId,
            leadDays: Math.max(1, leadDays),
            unitPrice: Number(best.price),
        };
    }
    async upsertSchedule(tenantId, productId, result) {
        const existing = await this.scheduleRepo.findOne({ where: { tenantId, productId } });
        const payload = { tenantId, productId, serviceLevel: SERVICE_LEVEL_Z, ...result };
        if (existing) {
            await this.scheduleRepo.update(existing.id, payload);
        }
        else {
            await this.scheduleRepo.save(this.scheduleRepo.create(payload));
        }
    }
};
exports.EoqService = EoqService;
__decorate([
    (0, schedule_1.Cron)('0 3 * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], EoqService.prototype, "refreshAllSchedules", null);
exports.EoqService = EoqService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(procurement_schedule_entity_1.ProcurementSchedule)),
    __param(1, (0, typeorm_1.InjectRepository)(consumption_snapshot_entity_1.ConsumptionSnapshot)),
    __param(2, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(3, (0, typeorm_1.InjectRepository)(supplier_catalog_item_entity_1.SupplierCatalogItem)),
    __param(4, (0, typeorm_1.InjectRepository)(supplier_reliability_score_entity_1.SupplierReliabilityScore)),
    __param(5, (0, typeorm_1.InjectRepository)(preferred_supplier_entity_1.PreferredSupplier)),
    __param(6, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], EoqService);
//# sourceMappingURL=eoq.service.js.map
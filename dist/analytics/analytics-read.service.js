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
exports.AnalyticsReadService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const price_snapshot_entity_1 = require("./entities/price-snapshot.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const supplier_profile_entity_1 = require("../supplier/entities/supplier-profile.entity");
const weekly_analytics_snapshot_entity_1 = require("./entities/weekly-analytics-snapshot.entity");
let AnalyticsReadService = class AnalyticsReadService {
    constructor(priceSnapshotRepo, inventoryRepo, tenantRepo, profileRepo, snapshotRepo, dataSource) {
        this.priceSnapshotRepo = priceSnapshotRepo;
        this.inventoryRepo = inventoryRepo;
        this.tenantRepo = tenantRepo;
        this.profileRepo = profileRepo;
        this.snapshotRepo = snapshotRepo;
        this.dataSource = dataSource;
    }
    async getDemandSignalsForSupplier(supplierTenantId, deliveryZones) {
        if (!deliveryZones.length)
            return [];
        const pharmacies = await this.tenantRepo
            .createQueryBuilder('t')
            .where("t.type = 'pharmacy'")
            .andWhere('t.isActive = true')
            .andWhere('t.region IN (:...zones)', { zones: deliveryZones })
            .getMany();
        if (!pharmacies.length)
            return [];
        const pharmacyIds = pharmacies.map((p) => p.id);
        const regionMap = new Map(pharmacies.map((p) => [p.id, p.region]));
        const lowStock = await this.dataSource.query(`
      SELECT
        i."productId",
        p.name        AS "productName",
        p.category,
        i."pharmacyTenantId" AS "tenantId",
        (i."minThreshold" - i.quantity) AS deficit
      FROM inventory_items i
      JOIN products p ON p.id = i."productId"
      WHERE i."pharmacyTenantId" = ANY($1)
        AND i."deletedAt" IS NULL
        AND i.quantity <= i."minThreshold"
      `, [pharmacyIds]);
        if (!lowStock.length)
            return [];
        const productMap = new Map();
        for (const row of lowStock) {
            if (!productMap.has(row.productId)) {
                productMap.set(row.productId, {
                    productName: row.productName,
                    category: row.category,
                    tenantIds: new Set(),
                    regions: new Set(),
                    maxDeficit: 0,
                });
            }
            const entry = productMap.get(row.productId);
            entry.tenantIds.add(row.tenantId);
            entry.regions.add(regionMap.get(row.tenantId) ?? 'unknown');
            entry.maxDeficit = Math.max(entry.maxDeficit, row.deficit);
        }
        const signals = Array.from(productMap.entries()).map(([productId, data]) => ({
            productId,
            productName: data.productName,
            category: data.category,
            severity: data.tenantIds.size >= 5 ? 'critical' : data.tenantIds.size >= 2 ? 'high' : 'medium',
            affectedCount: data.tenantIds.size,
            regionCount: data.regions.size,
        }));
        return signals.sort((a, b) => {
            const order = { critical: 0, high: 1, medium: 2 };
            return order[a.severity] - order[b.severity];
        });
    }
    async getPriceTrend(supplierTenantId, productId, days = 90) {
        const since = new Date(Date.now() - days * 86_400_000);
        const snapshots = await this.priceSnapshotRepo
            .createQueryBuilder('s')
            .where('s.supplierTenantId = :supplierTenantId', { supplierTenantId })
            .andWhere('s.productId = :productId', { productId })
            .andWhere('s.recordedAt >= :since', { since })
            .orderBy('s.recordedAt', 'ASC')
            .getMany();
        return snapshots.map((s) => ({
            date: s.recordedAt.toISOString().split('T')[0],
            price: Number(s.price),
            currency: s.currency,
            stockAtTime: s.stockAtTime ?? null,
        }));
    }
    async getRegionalPricing(productId) {
        const latest = await this.dataSource.query(`
        SELECT DISTINCT ON (s."supplierTenantId")
          s."supplierTenantId",
          s.price,
          s.currency,
          s."recordedAt"
        FROM price_snapshots s
        WHERE s."productId" = $1
        ORDER BY s."supplierTenantId", s."recordedAt" DESC
        `, [productId]);
        if (!latest.length)
            return [];
        const supplierIds = latest.map((r) => r.supplierTenantId);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
        const old = await this.dataSource.query(`
      SELECT DISTINCT ON (s."supplierTenantId")
        s."supplierTenantId",
        s.price
      FROM price_snapshots s
      WHERE s."productId" = $1
        AND s."supplierTenantId" = ANY($2)
        AND s."recordedAt" <= $3
      ORDER BY s."supplierTenantId", s."recordedAt" DESC
      `, [productId, supplierIds, thirtyDaysAgo]);
        const oldMap = new Map(old.map((r) => [r.supplierTenantId, parseFloat(r.price)]));
        const profiles = await this.profileRepo.find({
            where: supplierIds.map((id) => ({ supplierTenantId: id })),
        });
        const regionMap = new Map(profiles.flatMap((p) => p.deliveryZones.map((zone) => [p.supplierTenantId, zone])));
        return latest.map((r) => {
            const latestPrice = parseFloat(r.price);
            const oldPrice = oldMap.get(r.supplierTenantId);
            const change = oldPrice ? Math.round(((latestPrice - oldPrice) / oldPrice) * 100) : null;
            return {
                supplierTenantId: r.supplierTenantId,
                region: regionMap.get(r.supplierTenantId) ?? 'unknown',
                latestPrice,
                currency: r.currency,
                priceChange30d: change,
            };
        });
    }
    async getWeeklySnapshots(tenantId, weeks = 12) {
        return this.snapshotRepo
            .createQueryBuilder('s')
            .where('s.tenantId = :tenantId', { tenantId })
            .orderBy('s.weekStart', 'DESC')
            .take(weeks)
            .getMany();
    }
};
exports.AnalyticsReadService = AnalyticsReadService;
exports.AnalyticsReadService = AnalyticsReadService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(price_snapshot_entity_1.PriceSnapshot)),
    __param(1, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(2, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __param(3, (0, typeorm_1.InjectRepository)(supplier_profile_entity_1.SupplierProfile)),
    __param(4, (0, typeorm_1.InjectRepository)(weekly_analytics_snapshot_entity_1.WeeklyAnalyticsSnapshot)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], AnalyticsReadService);
//# sourceMappingURL=analytics-read.service.js.map
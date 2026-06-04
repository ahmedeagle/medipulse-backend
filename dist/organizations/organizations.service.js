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
exports.OrganizationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const organization_entity_1 = require("./entities/organization.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const order_entity_1 = require("../orders/entities/order.entity");
let OrganizationsService = class OrganizationsService {
    constructor(orgRepo, tenantRepo, inventoryRepo, orderRepo, dataSource) {
        this.orgRepo = orgRepo;
        this.tenantRepo = tenantRepo;
        this.inventoryRepo = inventoryRepo;
        this.orderRepo = orderRepo;
        this.dataSource = dataSource;
    }
    async create(dto) {
        const existing = await this.orgRepo.findOne({ where: { slug: dto.slug } });
        if (existing)
            throw new common_1.ConflictException(`Organization slug "${dto.slug}" already exists`);
        return this.orgRepo.save(this.orgRepo.create(dto));
    }
    async findAll() {
        return this.orgRepo.find({ order: { name: 'ASC' } });
    }
    async addBranch(organizationId, tenantId, branchRole = 'branch') {
        const org = await this.orgRepo.findOne({ where: { id: organizationId } });
        if (!org)
            throw new common_1.NotFoundException(`Organization ${organizationId} not found`);
        const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
        if (!tenant)
            throw new common_1.NotFoundException(`Tenant ${tenantId} not found`);
        await this.tenantRepo.update(tenantId, { organizationId, branchRole });
        return this.tenantRepo.findOne({ where: { id: tenantId } });
    }
    async removeBranch(tenantId) {
        await this.tenantRepo.update(tenantId, { organizationId: null, branchRole: 'standalone' });
        return this.tenantRepo.findOne({ where: { id: tenantId } });
    }
    async getBranches(organizationId) {
        return this.tenantRepo.find({
            where: { organizationId },
            order: { name: 'ASC' },
        });
    }
    async getAggregatedInventory(organizationId) {
        const branches = await this.getBranches(organizationId);
        if (!branches.length)
            return [];
        const branchIds = branches.map((b) => b.id);
        const lowStockItems = await this.inventoryRepo
            .createQueryBuilder('i')
            .leftJoinAndSelect('i.product', 'p')
            .where('i.pharmacyTenantId IN (:...branchIds)', { branchIds })
            .andWhere('i.deletedAt IS NULL')
            .andWhere('i.quantity <= i.minThreshold')
            .orderBy('i.quantity', 'ASC')
            .getMany();
        const tenantMap = new Map(branches.map((b) => [b.id, b.name]));
        const grouped = new Map();
        for (const item of lowStockItems) {
            if (!grouped.has(item.pharmacyTenantId))
                grouped.set(item.pharmacyTenantId, []);
            grouped.get(item.pharmacyTenantId).push(item);
        }
        return branches
            .filter((b) => grouped.has(b.id))
            .map((b) => ({
            tenantId: b.id,
            tenantName: b.name,
            lowStockItems: grouped.get(b.id) ?? [],
        }));
    }
    async getAggregatedOrders(organizationId, statusFilter) {
        const branches = await this.getBranches(organizationId);
        if (!branches.length)
            return [];
        const branchIds = branches.map((b) => b.id);
        const qb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.items', 'items')
            .leftJoinAndSelect('items.product', 'product')
            .leftJoinAndSelect('o.pharmacyTenant', 'pharmacyTenant')
            .leftJoinAndSelect('o.supplierTenant', 'supplierTenant')
            .where('o.pharmacyTenantId IN (:...branchIds)', { branchIds });
        if (statusFilter?.length) {
            qb.andWhere('o.status IN (:...statuses)', { statuses: statusFilter });
        }
        return qb.orderBy('o.createdAt', 'DESC').getMany();
    }
    async getSpendAnalytics(organizationId) {
        const branches = await this.getBranches(organizationId);
        if (!branches.length)
            return [];
        const branchIds = branches.map((b) => b.id);
        const rows = await this.dataSource.query(`
        SELECT
          o."pharmacyTenantId",
          SUM(o."totalAmount") AS "totalSpend",
          COUNT(o.id)          AS "orderCount"
        FROM orders o
        WHERE o."pharmacyTenantId" = ANY($1)
          AND o.status = 'delivered'
          AND o."createdAt" >= NOW() - INTERVAL '90 days'
        GROUP BY o."pharmacyTenantId"
        `, [branchIds]);
        const rowMap = new Map(rows.map((r) => [r.pharmacyTenantId, r]));
        return branches.map((b) => {
            const row = rowMap.get(b.id);
            return {
                branchId: b.id,
                branchName: b.name,
                totalSpend: row ? parseFloat(row.totalSpend) : 0,
                orderCount: row ? parseInt(row.orderCount, 10) : 0,
                currency: 'SAR',
            };
        });
    }
};
exports.OrganizationsService = OrganizationsService;
exports.OrganizationsService = OrganizationsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(organization_entity_1.Organization)),
    __param(1, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __param(2, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(3, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], OrganizationsService);
//# sourceMappingURL=organizations.service.js.map
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
var ProcurementDraftService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcurementDraftService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const procurement_draft_entity_1 = require("./entities/procurement-draft.entity");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const supplier_reliability_score_entity_1 = require("../supplier/entities/supplier-reliability-score.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const order_entity_1 = require("../orders/entities/order.entity");
const order_item_entity_1 = require("../orders/entities/order-item.entity");
const order_status_enum_1 = require("../common/enums/order-status.enum");
const recommendation_type_enum_1 = require("../common/enums/recommendation-type.enum");
let ProcurementDraftService = ProcurementDraftService_1 = class ProcurementDraftService {
    constructor(draftRepo, recRepo, catalogRepo, scoreRepo, inventoryRepo, orderRepo, orderItemRepo, dataSource) {
        this.draftRepo = draftRepo;
        this.recRepo = recRepo;
        this.catalogRepo = catalogRepo;
        this.scoreRepo = scoreRepo;
        this.inventoryRepo = inventoryRepo;
        this.orderRepo = orderRepo;
        this.orderItemRepo = orderItemRepo;
        this.dataSource = dataSource;
        this.logger = new common_1.Logger(ProcurementDraftService_1.name);
    }
    async generateFromRecommendation(recommendationId, tenantId) {
        const rec = await this.recRepo.findOne({
            where: { id: recommendationId, pharmacyTenantId: tenantId },
            relations: ['product'],
        });
        if (!rec || rec.type !== recommendation_type_enum_1.RecommendationType.REORDER || rec.riskLevel !== 'HIGH') {
            return null;
        }
        const existing = await this.draftRepo.findOne({
            where: {
                pharmacyTenantId: tenantId,
                productId: rec.productId,
                status: (0, typeorm_2.In)(['pending_review']),
            },
        });
        if (existing)
            return existing;
        const listings = await this.catalogRepo
            .createQueryBuilder('c')
            .where('c.productId = :productId', { productId: rec.productId })
            .andWhere('c.isAvailable = true')
            .andWhere('c.deletedAt IS NULL')
            .getMany();
        if (!listings.length)
            return null;
        const scores = await this.scoreRepo.find({
            where: { supplierTenantId: (0, typeorm_2.In)(listings.map((l) => l.supplierTenantId)) },
        });
        const scoreMap = new Map(scores.map((s) => [s.supplierTenantId, Number(s.overallScore)]));
        const bestListing = listings.reduce((best, l) => {
            if (!best)
                return l;
            const bestScore = scoreMap.get(best.supplierTenantId) ?? 0;
            const thisScore = scoreMap.get(l.supplierTenantId) ?? 0;
            if (thisScore !== bestScore)
                return thisScore > bestScore ? l : best;
            return Number(l.price) < Number(best.price) ? l : best;
        }, null);
        const suggestedQty = rec.payload?.suggestedReorderQty ?? rec.payload?.deficit ?? 10;
        const urgencyLevel = 'critical';
        const expiresAt = new Date(Date.now() + 48 * 3_600_000);
        const draft = this.draftRepo.create({
            pharmacyTenantId: tenantId,
            supplierTenantId: bestListing.supplierTenantId,
            productId: rec.productId,
            suggestedQuantity: Math.max(1, Math.round(suggestedQty)),
            unitPrice: Number(bestListing.price),
            currency: bestListing.currency,
            urgencyLevel,
            recommendationId,
            expiresAt,
        });
        return this.draftRepo.save(draft);
    }
    async findPending(pharmacyTenantId) {
        return this.draftRepo
            .createQueryBuilder('d')
            .where('d.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
            .andWhere('d.status = :status', { status: 'pending_review' })
            .andWhere('d.expiresAt > NOW()')
            .orderBy("CASE d.urgencyLevel WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END", 'ASC')
            .addOrderBy('d.createdAt', 'ASC')
            .getMany();
    }
    async getProcurementQueue(pharmacyTenantId) {
        const [criticalDrafts, expiringStock, pendingOrders] = await Promise.all([
            this.findPending(pharmacyTenantId),
            this.inventoryRepo
                .createQueryBuilder('i')
                .leftJoinAndSelect('i.product', 'p')
                .where('i.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
                .andWhere('i.deletedAt IS NULL')
                .andWhere('i.expiryDate IS NOT NULL')
                .andWhere('i.expiryDate <= NOW() + INTERVAL \'30 days\'')
                .andWhere('i.expiryDate > NOW()')
                .orderBy('i.expiryDate', 'ASC')
                .getMany(),
            this.orderRepo
                .createQueryBuilder('o')
                .leftJoinAndSelect('o.items', 'items')
                .leftJoinAndSelect('items.product', 'product')
                .where('o.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
                .andWhere('o.status IN (:...statuses)', {
                statuses: [order_status_enum_1.OrderStatus.SUBMITTED, order_status_enum_1.OrderStatus.ACCEPTED, order_status_enum_1.OrderStatus.SHIPPED],
            })
                .orderBy('o.createdAt', 'ASC')
                .getMany(),
        ]);
        return { criticalDrafts, expiringStock, pendingOrders };
    }
    async approveDraft(pharmacyTenantId, draftId) {
        const draft = await this.findOwned(pharmacyTenantId, draftId);
        if (draft.status !== 'pending_review') {
            throw new common_1.BadRequestException(`Draft is already ${draft.status}`);
        }
        if (draft.expiresAt < new Date()) {
            throw new common_1.BadRequestException('Draft has expired — generate a new recommendation');
        }
        const listing = await this.catalogRepo.findOne({
            where: {
                supplierTenantId: draft.supplierTenantId,
                productId: draft.productId,
                isAvailable: true,
            },
        });
        if (!listing) {
            throw new common_1.BadRequestException('Supplier product is no longer available — reject this draft');
        }
        if (listing.stock > 0 && Number(listing.stock) < draft.suggestedQuantity) {
            throw new common_1.BadRequestException(`Insufficient supplier stock. Available: ${listing.stock} units, draft requests: ${draft.suggestedQuantity} units. ` +
                `Reject this draft and generate a new recommendation.`);
        }
        const unitPrice = Number(listing.price);
        const subtotalAmount = unitPrice * draft.suggestedQuantity;
        const vatRate = 0.15;
        const vatAmount = Math.round(subtotalAmount * vatRate * 100) / 100;
        const totalAmount = Math.round((subtotalAmount + vatAmount) * 100) / 100;
        const qr = this.dataSource.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        try {
            const order = qr.manager.create(order_entity_1.Order, {
                pharmacyTenantId,
                supplierTenantId: draft.supplierTenantId,
                currency: 'SAR',
                subtotalAmount,
                vatRate,
                vatAmount,
                totalAmount,
                status: order_status_enum_1.OrderStatus.SUBMITTED,
                notes: `Auto-generated from procurement draft ${draft.id}`,
            });
            const savedOrder = await qr.manager.save(order_entity_1.Order, order);
            await qr.manager.save(order_item_entity_1.OrderItem, qr.manager.create(order_item_entity_1.OrderItem, {
                orderId: savedOrder.id,
                productId: draft.productId,
                quantity: draft.suggestedQuantity,
                unitPrice,
                totalPrice: totalAmount,
            }));
            await qr.manager.update(procurement_draft_entity_1.ProcurementDraft, draftId, {
                status: 'converted_to_order',
                convertedOrderId: savedOrder.id,
            });
            await qr.commitTransaction();
            this.logger.log(`Draft ${draftId} approved → order ${savedOrder.id}`);
            return this.orderRepo.findOne({
                where: { id: savedOrder.id },
                relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'],
            });
        }
        catch (err) {
            await qr.rollbackTransaction();
            throw err;
        }
        finally {
            await qr.release();
        }
    }
    async rejectDraft(pharmacyTenantId, draftId, reason) {
        const draft = await this.findOwned(pharmacyTenantId, draftId);
        if (draft.status !== 'pending_review') {
            throw new common_1.BadRequestException(`Draft is already ${draft.status}`);
        }
        await this.draftRepo.update(draftId, { status: 'rejected', rejectionReason: reason ?? null });
        return this.draftRepo.findOne({ where: { id: draftId } });
    }
    async expireStaleDrafts() {
        const result = await this.draftRepo.update({ status: 'pending_review', expiresAt: (0, typeorm_2.LessThan)(new Date()) }, { status: 'expired' });
        if (result.affected) {
            this.logger.log(`Expired ${result.affected} stale procurement drafts`);
        }
    }
    async findOwned(pharmacyTenantId, draftId) {
        const draft = await this.draftRepo.findOne({ where: { id: draftId } });
        if (!draft)
            throw new common_1.NotFoundException(`Draft ${draftId} not found`);
        if (draft.pharmacyTenantId !== pharmacyTenantId)
            throw new common_1.ForbiddenException('Access denied');
        return draft;
    }
};
exports.ProcurementDraftService = ProcurementDraftService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_4AM),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ProcurementDraftService.prototype, "expireStaleDrafts", null);
exports.ProcurementDraftService = ProcurementDraftService = ProcurementDraftService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(procurement_draft_entity_1.ProcurementDraft)),
    __param(1, (0, typeorm_1.InjectRepository)(ai_recommendation_entity_1.AiRecommendation)),
    __param(2, (0, typeorm_1.InjectRepository)(supplier_catalog_item_entity_1.SupplierCatalogItem)),
    __param(3, (0, typeorm_1.InjectRepository)(supplier_reliability_score_entity_1.SupplierReliabilityScore)),
    __param(4, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(5, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __param(6, (0, typeorm_1.InjectRepository)(order_item_entity_1.OrderItem)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], ProcurementDraftService);
//# sourceMappingURL=procurement-draft.service.js.map
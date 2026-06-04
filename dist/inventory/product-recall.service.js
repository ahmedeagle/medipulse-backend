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
var ProductRecallService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductRecallService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const product_recall_entity_1 = require("./entities/product-recall.entity");
const product_batch_entity_1 = require("./entities/product-batch.entity");
const inventory_item_entity_1 = require("./entities/inventory-item.entity");
const domain_events_1 = require("../events/domain-events");
let ProductRecallService = ProductRecallService_1 = class ProductRecallService {
    constructor(recallRepo, batchRepo, inventoryRepo, dataSource, eventEmitter) {
        this.recallRepo = recallRepo;
        this.batchRepo = batchRepo;
        this.inventoryRepo = inventoryRepo;
        this.dataSource = dataSource;
        this.eventEmitter = eventEmitter;
        this.logger = new common_1.Logger(ProductRecallService_1.name);
    }
    async create(dto) {
        const inventoryQb = this.inventoryRepo
            .createQueryBuilder('i')
            .where('i.productId = :productId', { productId: dto.productId })
            .andWhere('i.quantity > 0')
            .andWhere('i.deletedAt IS NULL');
        const affectedInventory = await inventoryQb.getMany();
        const affectedPharmacyIds = [...new Set(affectedInventory.map((i) => i.pharmacyTenantId))];
        const recall = await this.recallRepo.save(this.recallRepo.create({
            productId: dto.productId,
            batchNumber: dto.batchNumber ?? null,
            recallType: dto.recallType,
            recallReferenceNumber: dto.recallReferenceNumber,
            description: dto.description ?? null,
            issuedAt: new Date(),
            effectiveAt: dto.effectiveAt ?? new Date(),
            resolutionDeadline: dto.resolutionDeadline ?? null,
            affectedPharmacyIds,
            status: 'active',
            createdByUserId: dto.createdByUserId ?? null,
        }));
        const qr = this.dataSource.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        try {
            const batchQb = qr.manager
                .createQueryBuilder(product_batch_entity_1.ProductBatch, 'b')
                .where('b.productId = :productId', { productId: dto.productId })
                .andWhere("b.status = 'active'");
            if (dto.batchNumber) {
                batchQb.andWhere('b.batchNumber = :batchNumber', { batchNumber: dto.batchNumber });
            }
            const affectedBatches = await batchQb.getMany();
            for (const batch of affectedBatches) {
                await qr.manager.update(product_batch_entity_1.ProductBatch, batch.id, {
                    status: 'recalled',
                    recallReferenceNumber: dto.recallReferenceNumber,
                    recallIssuedAt: new Date(),
                    recallId: recall.id,
                });
            }
            this.logger.log(`Recall ${recall.id}: ${affectedBatches.length} batch(es) marked recalled, ` +
                `${affectedPharmacyIds.length} pharmacies affected`);
            await qr.commitTransaction();
        }
        catch (err) {
            await qr.rollbackTransaction();
            throw err;
        }
        finally {
            await qr.release();
        }
        this.eventEmitter.emit(domain_events_1.EVENTS.PRODUCT_RECALLED, {
            recallId: recall.id,
            productId: dto.productId,
            batchNumber: dto.batchNumber,
            recallType: dto.recallType,
            recallReferenceNumber: dto.recallReferenceNumber,
            affectedPharmacyIds,
        });
        return recall;
    }
    async findAll() {
        return this.recallRepo.find({ order: { issuedAt: 'DESC' } });
    }
    async resolve(id) {
        const recall = await this.recallRepo.findOne({ where: { id } });
        if (!recall)
            throw new common_1.NotFoundException(`Recall ${id} not found`);
        await this.recallRepo.update(id, { status: 'resolved', resolvedAt: new Date() });
        return this.recallRepo.findOne({ where: { id } });
    }
};
exports.ProductRecallService = ProductRecallService;
exports.ProductRecallService = ProductRecallService = ProductRecallService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_recall_entity_1.ProductRecall)),
    __param(1, (0, typeorm_1.InjectRepository)(product_batch_entity_1.ProductBatch)),
    __param(2, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource,
        event_emitter_1.EventEmitter2])
], ProductRecallService);
//# sourceMappingURL=product-recall.service.js.map
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
exports.InventoryService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const inventory_item_entity_1 = require("./entities/inventory-item.entity");
const product_entity_1 = require("./entities/product.entity");
const domain_events_1 = require("../events/domain-events");
let InventoryService = class InventoryService {
    constructor(inventoryItemRepository, productRepository, eventEmitter) {
        this.inventoryItemRepository = inventoryItemRepository;
        this.productRepository = productRepository;
        this.eventEmitter = eventEmitter;
    }
    async findAll(tenantId) {
        return this.inventoryItemRepository
            .createQueryBuilder('item')
            .leftJoinAndSelect('item.product', 'product')
            .where('item.pharmacyTenantId = :tenantId', { tenantId })
            .andWhere('item.deletedAt IS NULL')
            .orderBy('product.name', 'ASC')
            .getMany();
    }
    async findLowStock(tenantId) {
        return this.inventoryItemRepository
            .createQueryBuilder('item')
            .leftJoinAndSelect('item.product', 'product')
            .where('item.pharmacyTenantId = :tenantId', { tenantId })
            .andWhere('item.deletedAt IS NULL')
            .andWhere('item.quantity <= item.minThreshold')
            .orderBy('item.quantity', 'ASC')
            .getMany();
    }
    async create(tenantId, dto) {
        const product = await this.productRepository.findOne({
            where: { id: dto.productId },
        });
        if (!product) {
            throw new common_1.NotFoundException(`Product with ID ${dto.productId} not found`);
        }
        const item = this.inventoryItemRepository.create({
            pharmacyTenantId: tenantId,
            productId: dto.productId,
            quantity: dto.quantity,
            minThreshold: dto.minThreshold,
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        });
        const saved = await this.inventoryItemRepository.save(item);
        return this.inventoryItemRepository.findOne({
            where: { id: saved.id },
            relations: ['product'],
        });
    }
    async update(tenantId, id, dto) {
        const item = await this.inventoryItemRepository.findOne({
            where: { id, deletedAt: (0, typeorm_2.IsNull)() },
            relations: ['product'],
        });
        if (!item) {
            throw new common_1.NotFoundException(`Inventory item with ID ${id} not found`);
        }
        if (item.pharmacyTenantId !== tenantId) {
            throw new common_1.ForbiddenException('You do not have access to this inventory item');
        }
        if (dto.productId && dto.productId !== item.productId) {
            const product = await this.productRepository.findOne({
                where: { id: dto.productId },
            });
            if (!product) {
                throw new common_1.NotFoundException(`Product with ID ${dto.productId} not found`);
            }
        }
        const previousQuantity = item.quantity;
        const updateData = {};
        if (dto.productId !== undefined)
            updateData.productId = dto.productId;
        if (dto.quantity !== undefined)
            updateData.quantity = dto.quantity;
        if (dto.minThreshold !== undefined)
            updateData.minThreshold = dto.minThreshold;
        if (dto.expiryDate !== undefined)
            updateData.expiryDate = new Date(dto.expiryDate);
        await this.inventoryItemRepository.update(id, updateData);
        const updated = await this.inventoryItemRepository.findOne({
            where: { id },
            relations: ['product'],
        });
        if (dto.quantity !== undefined && dto.quantity !== previousQuantity) {
            this.eventEmitter.emit(domain_events_1.EVENTS.INVENTORY_UPDATED, new domain_events_1.InventoryUpdatedEvent(tenantId, item.productId, dto.quantity, previousQuantity, 'manual'));
        }
        return updated;
    }
    async remove(tenantId, id) {
        const item = await this.inventoryItemRepository.findOne({
            where: { id, deletedAt: (0, typeorm_2.IsNull)() },
        });
        if (!item) {
            throw new common_1.NotFoundException(`Inventory item with ID ${id} not found`);
        }
        if (item.pharmacyTenantId !== tenantId) {
            throw new common_1.ForbiddenException('You do not have access to this inventory item');
        }
        await this.inventoryItemRepository.update(id, { deletedAt: new Date() });
        return { message: 'Inventory item deleted successfully' };
    }
    async createProduct(dto) {
        const product = this.productRepository.create(dto);
        return this.productRepository.save(product);
    }
    async findAllProducts(search, take = 50, skip = 0) {
        const qb = this.productRepository
            .createQueryBuilder('p')
            .orderBy('p.name', 'ASC')
            .take(Math.min(take, 200))
            .skip(skip);
        if (search?.trim()) {
            qb.where('(LOWER(p.name) LIKE :q OR LOWER(p.genericName) LIKE :q OR LOWER(p.activeIngredient) LIKE :q OR p.barcode = :exact)', { q: `%${search.toLowerCase().trim()}%`, exact: search.trim() });
        }
        const [data, total] = await qb.getManyAndCount();
        return { data, total };
    }
    async findProductById(id) {
        const product = await this.productRepository.findOne({ where: { id } });
        if (!product) {
            throw new common_1.NotFoundException(`Product with ID ${id} not found`);
        }
        return product;
    }
};
exports.InventoryService = InventoryService;
exports.InventoryService = InventoryService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(1, (0, typeorm_1.InjectRepository)(product_entity_1.Product)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        event_emitter_1.EventEmitter2])
], InventoryService);
//# sourceMappingURL=inventory.service.js.map
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
exports.SupplierService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const supplier_catalog_item_entity_1 = require("./entities/supplier-catalog-item.entity");
const domain_events_1 = require("../events/domain-events");
let SupplierService = class SupplierService {
    constructor(catalogRepository, eventEmitter) {
        this.catalogRepository = catalogRepository;
        this.eventEmitter = eventEmitter;
    }
    async findMyCatalog(supplierTenantId) {
        return this.catalogRepository
            .createQueryBuilder('item')
            .leftJoinAndSelect('item.product', 'product')
            .where('item.supplierTenantId = :supplierTenantId', { supplierTenantId })
            .andWhere('item.deletedAt IS NULL')
            .orderBy('product.name', 'ASC')
            .getMany();
    }
    async findAllCatalog() {
        return this.catalogRepository
            .createQueryBuilder('item')
            .leftJoinAndSelect('item.supplierTenant', 'supplierTenant')
            .leftJoinAndSelect('item.product', 'product')
            .where('item.deletedAt IS NULL')
            .andWhere('item.isAvailable = true')
            .orderBy('product.name', 'ASC')
            .addOrderBy('item.price', 'ASC')
            .getMany();
    }
    async findCatalogForPharmacy(productIds) {
        if (!productIds.length)
            return [];
        return this.catalogRepository
            .createQueryBuilder('item')
            .leftJoinAndSelect('item.supplierTenant', 'supplierTenant')
            .leftJoinAndSelect('item.product', 'product')
            .where('item.productId IN (:...productIds)', { productIds })
            .andWhere('item.deletedAt IS NULL')
            .andWhere('item.isAvailable = true')
            .orderBy('item.price', 'ASC')
            .getMany();
    }
    async findCatalogByProduct(productId) {
        return this.catalogRepository
            .createQueryBuilder('item')
            .leftJoinAndSelect('item.supplierTenant', 'supplierTenant')
            .leftJoinAndSelect('item.product', 'product')
            .where('item.productId = :productId', { productId })
            .andWhere('item.deletedAt IS NULL')
            .orderBy('item.price', 'ASC')
            .getMany();
    }
    async create(supplierTenantId, dto) {
        const item = this.catalogRepository.create({
            supplierTenantId,
            productId: dto.productId,
            price: dto.price,
            isAvailable: dto.isAvailable !== undefined ? dto.isAvailable : true,
            stock: dto.stock !== undefined ? dto.stock : 0,
        });
        const saved = await this.catalogRepository.save(item);
        return this.catalogRepository.findOne({
            where: { id: saved.id },
            relations: ['product', 'supplierTenant'],
        });
    }
    async update(supplierTenantId, id, dto) {
        const item = await this.catalogRepository.findOne({
            where: { id, deletedAt: (0, typeorm_2.IsNull)() },
        });
        if (!item) {
            throw new common_1.NotFoundException(`Catalog item with ID ${id} not found`);
        }
        if (item.supplierTenantId !== supplierTenantId) {
            throw new common_1.ForbiddenException('You do not have access to this catalog item');
        }
        const updateData = {};
        if (dto.price !== undefined)
            updateData.price = dto.price;
        if (dto.isAvailable !== undefined)
            updateData.isAvailable = dto.isAvailable;
        if (dto.stock !== undefined)
            updateData.stock = dto.stock;
        await this.catalogRepository.update(id, updateData);
        const updated = await this.catalogRepository.findOne({
            where: { id },
            relations: ['product', 'supplierTenant'],
        });
        if (dto.stock !== undefined || dto.price !== undefined) {
            this.eventEmitter.emit(domain_events_1.EVENTS.SUPPLIER_STOCK_CHANGED, new domain_events_1.SupplierStockChangedEvent(id, supplierTenantId, item.productId, dto.stock ?? Number(item.stock), dto.price !== undefined ? Number(dto.price) : Number(item.price)));
        }
        return updated;
    }
    async remove(supplierTenantId, id) {
        const item = await this.catalogRepository.findOne({
            where: { id, deletedAt: (0, typeorm_2.IsNull)() },
        });
        if (!item) {
            throw new common_1.NotFoundException(`Catalog item with ID ${id} not found`);
        }
        if (item.supplierTenantId !== supplierTenantId) {
            throw new common_1.ForbiddenException('You do not have access to this catalog item');
        }
        await this.catalogRepository.update(id, { deletedAt: new Date() });
        return { message: 'Catalog item deleted successfully' };
    }
};
exports.SupplierService = SupplierService;
exports.SupplierService = SupplierService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(supplier_catalog_item_entity_1.SupplierCatalogItem)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        event_emitter_1.EventEmitter2])
], SupplierService);
//# sourceMappingURL=supplier.service.js.map
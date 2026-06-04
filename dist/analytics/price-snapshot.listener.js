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
var PriceSnapshotListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceSnapshotListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const price_snapshot_entity_1 = require("./entities/price-snapshot.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const domain_events_1 = require("../events/domain-events");
let PriceSnapshotListener = PriceSnapshotListener_1 = class PriceSnapshotListener {
    constructor(snapshotRepo, catalogRepo) {
        this.snapshotRepo = snapshotRepo;
        this.catalogRepo = catalogRepo;
        this.logger = new common_1.Logger(PriceSnapshotListener_1.name);
    }
    async onSupplierStockChanged(event) {
        try {
            const lastSnapshot = await this.snapshotRepo
                .createQueryBuilder('s')
                .where('s.supplierTenantId = :supplierTenantId', { supplierTenantId: event.supplierTenantId })
                .andWhere('s.productId = :productId', { productId: event.productId })
                .orderBy('s.recordedAt', 'DESC')
                .getOne();
            if (lastSnapshot && Number(lastSnapshot.price) === event.price)
                return;
            await this.snapshotRepo.save(this.snapshotRepo.create({
                supplierTenantId: event.supplierTenantId,
                productId: event.productId,
                price: event.price,
                stockAtTime: event.stock,
            }));
        }
        catch (err) {
            this.logger.error(`PriceSnapshot write failed: ${err.message}`);
        }
    }
};
exports.PriceSnapshotListener = PriceSnapshotListener;
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.SUPPLIER_STOCK_CHANGED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.SupplierStockChangedEvent]),
    __metadata("design:returntype", Promise)
], PriceSnapshotListener.prototype, "onSupplierStockChanged", null);
exports.PriceSnapshotListener = PriceSnapshotListener = PriceSnapshotListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(price_snapshot_entity_1.PriceSnapshot)),
    __param(1, (0, typeorm_1.InjectRepository)(supplier_catalog_item_entity_1.SupplierCatalogItem)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], PriceSnapshotListener);
//# sourceMappingURL=price-snapshot.listener.js.map
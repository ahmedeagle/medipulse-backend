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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierCatalogItem = void 0;
const typeorm_1 = require("typeorm");
const tenant_entity_1 = require("../../auth/entities/tenant.entity");
const product_entity_1 = require("../../inventory/entities/product.entity");
let SupplierCatalogItem = class SupplierCatalogItem {
};
exports.SupplierCatalogItem = SupplierCatalogItem;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], SupplierCatalogItem.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], SupplierCatalogItem.prototype, "supplierTenantId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => tenant_entity_1.Tenant, { eager: false }),
    (0, typeorm_1.JoinColumn)({ name: 'supplierTenantId' }),
    __metadata("design:type", tenant_entity_1.Tenant)
], SupplierCatalogItem.prototype, "supplierTenant", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], SupplierCatalogItem.prototype, "productId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => product_entity_1.Product, (product) => product.supplierCatalogItems, { eager: false }),
    (0, typeorm_1.JoinColumn)({ name: 'productId' }),
    __metadata("design:type", product_entity_1.Product)
], SupplierCatalogItem.prototype, "product", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 2 }),
    __metadata("design:type", Number)
], SupplierCatalogItem.prototype, "price", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 10, default: 'SAR' }),
    __metadata("design:type", String)
], SupplierCatalogItem.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: true }),
    __metadata("design:type", Boolean)
], SupplierCatalogItem.prototype, "isAvailable", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], SupplierCatalogItem.prototype, "stock", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Date)
], SupplierCatalogItem.prototype, "deletedAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], SupplierCatalogItem.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], SupplierCatalogItem.prototype, "createdAt", void 0);
exports.SupplierCatalogItem = SupplierCatalogItem = __decorate([
    (0, typeorm_1.Entity)('supplier_catalog'),
    (0, typeorm_1.Index)(['supplierTenantId', 'deletedAt']),
    (0, typeorm_1.Index)(['productId', 'isAvailable', 'deletedAt'])
], SupplierCatalogItem);
//# sourceMappingURL=supplier-catalog-item.entity.js.map
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
exports.ProductAlias = void 0;
const typeorm_1 = require("typeorm");
const product_entity_1 = require("../../inventory/entities/product.entity");
let ProductAlias = class ProductAlias {
};
exports.ProductAlias = ProductAlias;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ProductAlias.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], ProductAlias.prototype, "canonicalProductId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => product_entity_1.Product, { eager: false }),
    (0, typeorm_1.JoinColumn)({ name: 'canonicalProductId' }),
    __metadata("design:type", product_entity_1.Product)
], ProductAlias.prototype, "canonicalProduct", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], ProductAlias.prototype, "supplierTenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], ProductAlias.prototype, "supplierSku", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], ProductAlias.prototype, "supplierName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'confirmed' }),
    __metadata("design:type", String)
], ProductAlias.prototype, "mappingSource", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], ProductAlias.prototype, "mappedAt", void 0);
exports.ProductAlias = ProductAlias = __decorate([
    (0, typeorm_1.Entity)('product_aliases'),
    (0, typeorm_1.Index)(['supplierTenantId', 'supplierSku']),
    (0, typeorm_1.Index)(['canonicalProductId'])
], ProductAlias);
//# sourceMappingURL=product-alias.entity.js.map
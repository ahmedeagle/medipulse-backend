"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NormalizationModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const normalization_controller_1 = require("./normalization.controller");
const product_normalization_service_1 = require("./product-normalization.service");
const product_alias_entity_1 = require("./entities/product-alias.entity");
const product_entity_1 = require("../inventory/entities/product.entity");
let NormalizationModule = class NormalizationModule {
};
exports.NormalizationModule = NormalizationModule;
exports.NormalizationModule = NormalizationModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([product_entity_1.Product, product_alias_entity_1.ProductAlias])],
        controllers: [normalization_controller_1.NormalizationController],
        providers: [product_normalization_service_1.ProductNormalizationService],
        exports: [product_normalization_service_1.ProductNormalizationService],
    })
], NormalizationModule);
//# sourceMappingURL=normalization.module.js.map
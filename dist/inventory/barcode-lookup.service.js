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
var BarcodeLookupService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BarcodeLookupService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const axios_1 = require("axios");
const product_entity_1 = require("./entities/product.entity");
let BarcodeLookupService = BarcodeLookupService_1 = class BarcodeLookupService {
    constructor(productRepo) {
        this.productRepo = productRepo;
        this.logger = new common_1.Logger(BarcodeLookupService_1.name);
    }
    async lookup(barcode) {
        const localProduct = await this.productRepo.findOne({
            where: { barcode },
        });
        if (localProduct) {
            return {
                found: true,
                source: 'local_db',
                productId: localProduct.id,
                name: localProduct.name,
                genericName: localProduct.genericName,
                strength: localProduct.strength,
                dosageForm: localProduct.dosageForm,
                category: localProduct.category,
                unit: localProduct.unit,
            };
        }
        try {
            const res = await axios_1.default.get(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, { timeout: 5_000 });
            const product = res.data?.product;
            if (product && res.data?.status === 1) {
                const name = product.product_name_en
                    || product.product_name
                    || product.generic_name_en
                    || product.generic_name;
                if (name) {
                    return {
                        found: true,
                        source: 'open_food_facts',
                        name,
                        genericName: product.generic_name_en || product.generic_name || undefined,
                        manufacturer: product.brands || undefined,
                        category: this.guessCategory(product.categories_tags || []),
                        unit: 'unit',
                    };
                }
            }
        }
        catch (err) {
            this.logger.debug(`OpenFoodFacts lookup failed for ${barcode}: ${err.message}`);
        }
        return { found: false, source: 'not_found' };
    }
    guessCategory(categoryTags) {
        const tags = categoryTags.map(t => t.toLowerCase());
        if (tags.some(t => t.includes('antibiotic') || t.includes('penicillin')))
            return 'antibiotic';
        if (tags.some(t => t.includes('vitamin')))
            return 'vitamin';
        if (tags.some(t => t.includes('supplement')))
            return 'supplement';
        if (tags.some(t => t.includes('analgesic') || t.includes('pain')))
            return 'analgesic';
        if (tags.some(t => t.includes('antifungal')))
            return 'antifungal';
        if (tags.some(t => t.includes('antiviral')))
            return 'antiviral';
        if (tags.some(t => t.includes('cardiovascular') || t.includes('cardiac')))
            return 'cardiovascular';
        if (tags.some(t => t.includes('diabetes') || t.includes('insulin')))
            return 'diabetes';
        if (tags.some(t => t.includes('respiratory') || t.includes('bronch')))
            return 'respiratory';
        if (tags.some(t => t.includes('gastro') || t.includes('digestive')))
            return 'gastrointestinal';
        return 'general';
    }
};
exports.BarcodeLookupService = BarcodeLookupService;
exports.BarcodeLookupService = BarcodeLookupService = BarcodeLookupService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_entity_1.Product)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], BarcodeLookupService);
//# sourceMappingURL=barcode-lookup.service.js.map
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
exports.ProductNormalizationService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const product_entity_1 = require("../inventory/entities/product.entity");
const product_alias_entity_1 = require("./entities/product-alias.entity");
const DOSAGE_FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'inhaler', 'patch', 'gel', 'solution'];
const DOSAGE_FORM_PATTERNS = DOSAGE_FORMS.map((f) => ({ form: f, re: new RegExp(f, 'i') }));
const STRENGTH_RE = /\d+(?:\.\d+)?\s*(?:mg\/\d+\s*ml|mg\/ml|mg|ml|mcg|iu|g|%)/i;
let ProductNormalizationService = class ProductNormalizationService {
    constructor(productRepo, aliasRepo) {
        this.productRepo = productRepo;
        this.aliasRepo = aliasRepo;
    }
    normalize(name, genericName) {
        const source = genericName || name;
        const canonicalName = source.toLowerCase().trim().replace(/\s+/g, ' ');
        const strengthMatch = canonicalName.match(STRENGTH_RE);
        const strength = strengthMatch ? strengthMatch[0].trim() : null;
        const dosageFormMatch = DOSAGE_FORM_PATTERNS.find((p) => p.re.test(canonicalName));
        const dosageForm = dosageFormMatch?.form ?? null;
        return { canonicalName, strength, dosageForm };
    }
    async findOrCreateCanonical(dto) {
        const { canonicalName, strength, dosageForm } = this.normalize(dto.name, dto.genericName);
        const existing = await this.productRepo
            .createQueryBuilder('p')
            .where('p.canonicalName = :canonicalName', { canonicalName })
            .andWhere('p.isCanonical = true')
            .andWhere(strength ? 'p.strength = :strength' : 'p.strength IS NULL', strength ? { strength } : {})
            .andWhere(dosageForm ? 'p.dosageForm = :dosageForm' : 'p.dosageForm IS NULL', dosageForm ? { dosageForm } : {})
            .getOne();
        if (existing)
            return existing;
        return this.productRepo.save(this.productRepo.create({
            name: dto.name,
            genericName: dto.genericName ?? null,
            category: dto.category,
            unit: dto.unit,
            canonicalName,
            strength,
            dosageForm,
            isCanonical: true,
            requiresMapping: false,
        }));
    }
    async mapSupplierSku(supplierTenantId, supplierSku, canonicalProductId, supplierName) {
        const canonical = await this.productRepo.findOne({ where: { id: canonicalProductId, isCanonical: true } });
        if (!canonical)
            throw new common_1.NotFoundException(`Canonical product ${canonicalProductId} not found`);
        const existing = await this.aliasRepo.findOne({ where: { supplierTenantId, supplierSku } });
        if (existing) {
            await this.aliasRepo.update(existing.id, { canonicalProductId, supplierName, mappingSource: 'confirmed' });
            return this.aliasRepo.findOne({ where: { id: existing.id } });
        }
        return this.aliasRepo.save(this.aliasRepo.create({ supplierTenantId, supplierSku, canonicalProductId, supplierName, mappingSource: 'confirmed' }));
    }
    async resolveProductId(supplierTenantId, supplierSku) {
        const alias = await this.aliasRepo.findOne({ where: { supplierTenantId, supplierSku } });
        return alias?.canonicalProductId ?? null;
    }
    async autoSuggestMapping(productName, genericName) {
        const { canonicalName } = this.normalize(productName, genericName);
        const words = canonicalName.split(' ').filter((w) => w.length > 3).slice(0, 3);
        if (!words.length)
            return [];
        const qb = this.productRepo.createQueryBuilder('p').where('p.isCanonical = true');
        words.forEach((word, i) => qb.andWhere(`LOWER(p.canonicalName) LIKE :w${i}`, { [`w${i}`]: `%${word}%` }));
        return qb.limit(5).getMany();
    }
    async getUnmappedProducts() {
        return this.productRepo.find({ where: { requiresMapping: true } });
    }
    async getProductAliases(canonicalProductId) {
        const product = await this.productRepo.findOne({ where: { id: canonicalProductId } });
        if (!product)
            throw new common_1.NotFoundException(`Product ${canonicalProductId} not found`);
        return this.aliasRepo.find({ where: { canonicalProductId }, order: { mappedAt: 'DESC' } });
    }
};
exports.ProductNormalizationService = ProductNormalizationService;
exports.ProductNormalizationService = ProductNormalizationService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_entity_1.Product)),
    __param(1, (0, typeorm_1.InjectRepository)(product_alias_entity_1.ProductAlias)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], ProductNormalizationService);
//# sourceMappingURL=product-normalization.service.js.map
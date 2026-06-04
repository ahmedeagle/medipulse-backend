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
var CatalogImportService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogImportService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const sync_1 = require("csv-parse/sync");
const supplier_catalog_item_entity_1 = require("./entities/supplier-catalog-item.entity");
const product_normalization_service_1 = require("../normalization/product-normalization.service");
const REQUIRED_COLUMNS = ['productName', 'category', 'unit', 'price'];
let CatalogImportService = CatalogImportService_1 = class CatalogImportService {
    constructor(catalogRepo, normalization) {
        this.catalogRepo = catalogRepo;
        this.normalization = normalization;
        this.logger = new common_1.Logger(CatalogImportService_1.name);
    }
    async importCsv(supplierTenantId, fileBuffer) {
        let rows;
        try {
            rows = (0, sync_1.parse)(fileBuffer, {
                columns: (headers) => headers.map((h) => h.trim().replace(/\s+/g, '')),
                skip_empty_lines: true,
                trim: true,
            });
        }
        catch (err) {
            throw new common_1.BadRequestException(`Invalid CSV format: ${err.message}`);
        }
        if (!rows.length)
            throw new common_1.BadRequestException('CSV file contains no data rows');
        const firstRow = rows[0];
        const missing = REQUIRED_COLUMNS.filter((col) => !(col in firstRow));
        if (missing.length) {
            throw new common_1.BadRequestException(`Missing required columns: ${missing.join(', ')}`);
        }
        const result = {
            total: rows.length, imported: 0, skipped: 0, unmapped: 0, errors: [],
        };
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2;
            try {
                const price = parseFloat(row.price);
                if (isNaN(price) || price < 0) {
                    result.errors.push({ row: rowNum, reason: `Invalid price: "${row.price}"` });
                    result.skipped++;
                    continue;
                }
                const product = await this.normalization.findOrCreateCanonical({
                    name: row.productName,
                    genericName: row.genericName,
                    category: row.category,
                    unit: row.unit,
                });
                if (row.supplierSku?.trim()) {
                    await this.normalization.mapSupplierSku(supplierTenantId, row.supplierSku.trim(), product.id, row.productName);
                }
                if (product.requiresMapping)
                    result.unmapped++;
                const existing = await this.catalogRepo.findOne({
                    where: { supplierTenantId, productId: product.id, deletedAt: null },
                });
                if (existing) {
                    await this.catalogRepo.update(existing.id, {
                        price,
                        currency: row.currency ?? 'SAR',
                        stock: row.stock ? parseInt(row.stock, 10) : existing.stock,
                        isAvailable: true,
                    });
                }
                else {
                    await this.catalogRepo.save(this.catalogRepo.create({
                        supplierTenantId,
                        productId: product.id,
                        price,
                        currency: row.currency ?? 'SAR',
                        stock: row.stock ? parseInt(row.stock, 10) : 0,
                        isAvailable: true,
                    }));
                }
                result.imported++;
            }
            catch (err) {
                result.errors.push({ row: rowNum, reason: err.message });
                result.skipped++;
            }
        }
        this.logger.log(`CSV import for ${supplierTenantId}: ${result.imported} imported, ${result.skipped} skipped, ${result.unmapped} need mapping`);
        return result;
    }
};
exports.CatalogImportService = CatalogImportService;
exports.CatalogImportService = CatalogImportService = CatalogImportService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(supplier_catalog_item_entity_1.SupplierCatalogItem)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        product_normalization_service_1.ProductNormalizationService])
], CatalogImportService);
//# sourceMappingURL=catalog-import.service.js.map
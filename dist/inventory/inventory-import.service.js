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
var InventoryImportService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryImportService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const sync_1 = require("csv-parse/sync");
const inventory_item_entity_1 = require("./entities/inventory-item.entity");
const product_normalization_service_1 = require("../normalization/product-normalization.service");
const REQUIRED_COLS = ['productName', 'category', 'unit', 'quantity'];
let InventoryImportService = InventoryImportService_1 = class InventoryImportService {
    constructor(inventoryRepo, normalization) {
        this.inventoryRepo = inventoryRepo;
        this.normalization = normalization;
        this.logger = new common_1.Logger(InventoryImportService_1.name);
    }
    async importCsv(pharmacyTenantId, fileBuffer) {
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
            throw new common_1.BadRequestException('CSV contains no data rows');
        const missing = REQUIRED_COLS.filter((c) => !(c in rows[0]));
        if (missing.length) {
            throw new common_1.BadRequestException(`Missing required columns: ${missing.join(', ')}`);
        }
        const result = {
            total: rows.length, imported: 0, updated: 0, skipped: 0, errors: [],
        };
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2;
            try {
                const qty = parseInt(row.quantity, 10);
                if (isNaN(qty) || qty < 0) {
                    result.errors.push({ row: rowNum, reason: `Invalid quantity: "${row.quantity}"` });
                    result.skipped++;
                    continue;
                }
                const threshold = row.minThreshold ? parseInt(row.minThreshold, 10) : 10;
                const expiryDate = row.expiryDate ? new Date(row.expiryDate) : null;
                const product = await this.normalization.findOrCreateCanonical({
                    name: row.productName,
                    genericName: row.genericName,
                    category: row.category,
                    unit: row.unit,
                });
                const existing = await this.inventoryRepo.findOne({
                    where: { pharmacyTenantId, productId: product.id, deletedAt: null },
                });
                if (existing) {
                    await this.inventoryRepo.update(existing.id, {
                        quantity: qty,
                        minThreshold: isNaN(threshold) ? existing.minThreshold : threshold,
                        expiryDate: expiryDate ?? existing.expiryDate,
                    });
                    result.updated++;
                }
                else {
                    await this.inventoryRepo.save(this.inventoryRepo.create({
                        pharmacyTenantId,
                        productId: product.id,
                        quantity: qty,
                        minThreshold: isNaN(threshold) ? 10 : threshold,
                        expiryDate: expiryDate,
                    }));
                    result.imported++;
                }
            }
            catch (err) {
                result.errors.push({ row: rowNum, reason: err.message });
                result.skipped++;
            }
        }
        this.logger.log(`Inventory import for ${pharmacyTenantId}: ` +
            `${result.imported} new, ${result.updated} updated, ${result.skipped} skipped`);
        return result;
    }
};
exports.InventoryImportService = InventoryImportService;
exports.InventoryImportService = InventoryImportService = InventoryImportService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        product_normalization_service_1.ProductNormalizationService])
], InventoryImportService);
//# sourceMappingURL=inventory-import.service.js.map
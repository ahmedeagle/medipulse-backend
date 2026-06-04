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
exports.InventoryController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const inventory_service_1 = require("./inventory.service");
const inventory_import_service_1 = require("./inventory-import.service");
const barcode_lookup_service_1 = require("./barcode-lookup.service");
const create_inventory_item_dto_1 = require("./dto/create-inventory-item.dto");
const update_inventory_item_dto_1 = require("./dto/update-inventory-item.dto");
const create_product_dto_1 = require("./dto/create-product.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
let InventoryController = class InventoryController {
    constructor(inventoryService, importService, barcodeSvc) {
        this.inventoryService = inventoryService;
        this.importService = importService;
        this.barcodeSvc = barcodeSvc;
    }
    findAll(user) {
        return this.inventoryService.findAll(user.tenantId);
    }
    findLowStock(user) {
        return this.inventoryService.findLowStock(user.tenantId);
    }
    create(user, dto) {
        return this.inventoryService.create(user.tenantId, dto);
    }
    update(user, id, dto) {
        return this.inventoryService.update(user.tenantId, id, dto);
    }
    remove(user, id) {
        return this.inventoryService.remove(user.tenantId, id);
    }
    importInventory(user, file) {
        if (!file)
            throw new Error('No file uploaded');
        return this.importService.importCsv(user.tenantId, file.buffer);
    }
    lookupBarcode(barcode) {
        return this.barcodeSvc.lookup(barcode.replace(/\s/g, ''));
    }
    findAllProducts(search, take = 50, skip = 0) {
        return this.inventoryService.findAllProducts(search, take, skip);
    }
    createProduct(user, dto) {
        if (user.role === role_enum_1.Role.SUPPLIER_ADMIN) {
            return this.inventoryService.createProduct({ ...dto, requiresMapping: true });
        }
        return this.inventoryService.createProduct(dto);
    }
};
exports.InventoryController = InventoryController;
__decorate([
    (0, common_1.Get)('inventory'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Get all inventory items for the current pharmacy' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Returns all active inventory items with product details' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('inventory/low-stock'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Get low-stock inventory items (quantity <= minThreshold)' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Returns items that need restocking' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "findLowStock", null);
__decorate([
    (0, common_1.Post)('inventory'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Add a product to pharmacy inventory' }),
    (0, swagger_1.ApiCreatedResponse)({ description: 'Inventory item created successfully' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Product not found' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_inventory_item_dto_1.CreateInventoryItemDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)('inventory/:id'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Update an inventory item quantity, threshold or expiry' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Inventory item updated successfully' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Inventory item not found' }),
    (0, swagger_1.ApiForbiddenResponse)({ description: 'Item belongs to a different pharmacy' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_inventory_item_dto_1.UpdateInventoryItemDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)('inventory/:id'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Soft-delete an inventory item' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Inventory item deleted successfully' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Inventory item not found' }),
    (0, swagger_1.ApiForbiddenResponse)({ description: 'Item belongs to a different pharmacy' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)('inventory/import'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        description: 'CSV file. Headers: productName, genericName, category, unit, quantity, minThreshold, expiryDate, barcode',
    }),
    (0, swagger_1.ApiOperation)({
        summary: 'Bulk import pharmacy inventory from CSV — solves onboarding friction',
        description: 'Upload up to 500 products in one step. Each row is auto-mapped via the normalization ' +
            'engine. Existing items are updated; new items are created. Returns full import report.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "importInventory", null);
__decorate([
    (0, common_1.Get)('products/barcode/:barcode'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Barcode lookup — find or auto-populate product from barcode/GTIN',
        description: 'Checks local DB first. Falls back to Open Food Facts global database. ' +
            'If found in local DB, returns productId ready to use. ' +
            'If found externally, returns pre-filled form data to confirm before saving.',
    }),
    __param(0, (0, common_1.Param)('barcode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "lookupBarcode", null);
__decorate([
    (0, common_1.Get)('products'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN, role_enum_1.Role.SYSTEM_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Search the product master catalog',
        description: 'Supports fuzzy search by name, generic name, active ingredient, or exact barcode.',
    }),
    (0, swagger_1.ApiOkResponse)({ description: '{ data: Product[], total: number }' }),
    __param(0, (0, common_1.Query)('search')),
    __param(1, (0, common_1.Query)('take', new common_1.DefaultValuePipe(50), common_1.ParseIntPipe)),
    __param(2, (0, common_1.Query)('skip', new common_1.DefaultValuePipe(0), common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "findAllProducts", null);
__decorate([
    (0, common_1.Post)('products'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Create a new product in the master catalog',
        description: 'System admin creates verified products. ' +
            'Supplier admin can also create products — they are flagged as requiresMapping=true ' +
            'until a system admin maps them to a canonical product via /normalization.',
    }),
    (0, swagger_1.ApiCreatedResponse)({ description: 'Product created successfully' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_product_dto_1.CreateProductDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "createProduct", null);
exports.InventoryController = InventoryController = __decorate([
    (0, swagger_1.ApiTags)('inventory'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [inventory_service_1.InventoryService,
        inventory_import_service_1.InventoryImportService,
        barcode_lookup_service_1.BarcodeLookupService])
], InventoryController);
//# sourceMappingURL=inventory.controller.js.map
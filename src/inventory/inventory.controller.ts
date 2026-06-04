import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  UseGuards,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { InventoryImportService } from './inventory-import.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('inventory')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly importService: InventoryImportService,
    private readonly barcodeSvc: BarcodeLookupService,
  ) {}

  @Get('inventory')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Get all inventory items for the current pharmacy' })
  @ApiOkResponse({ description: 'Returns all active inventory items with product details' })
  findAll(@CurrentUser() user: any) {
    return this.inventoryService.findAll(user.tenantId);
  }

  @Get('inventory/low-stock')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Get low-stock inventory items (quantity <= minThreshold)' })
  @ApiOkResponse({ description: 'Returns items that need restocking' })
  findLowStock(@CurrentUser() user: any) {
    return this.inventoryService.findLowStock(user.tenantId);
  }

  @Post('inventory')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Add a product to pharmacy inventory' })
  @ApiCreatedResponse({ description: 'Inventory item created successfully' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  create(@CurrentUser() user: any, @Body() dto: CreateInventoryItemDto) {
    return this.inventoryService.create(user.tenantId, dto);
  }

  @Patch('inventory/:id')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Update an inventory item quantity, threshold or expiry' })
  @ApiOkResponse({ description: 'Inventory item updated successfully' })
  @ApiNotFoundResponse({ description: 'Inventory item not found' })
  @ApiForbiddenResponse({ description: 'Item belongs to a different pharmacy' })
  update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.inventoryService.update(user.tenantId, id, dto);
  }

  @Delete('inventory/:id')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Soft-delete an inventory item' })
  @ApiOkResponse({ description: 'Inventory item deleted successfully' })
  @ApiNotFoundResponse({ description: 'Inventory item not found' })
  @ApiForbiddenResponse({ description: 'Item belongs to a different pharmacy' })
  remove(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.remove(user.tenantId, id);
  }

  @Post('inventory/import')
  @Roles(Role.PHARMACY_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'CSV file. Headers: productName, genericName, category, unit, quantity, minThreshold, expiryDate, barcode',
  })
  @ApiOperation({
    summary: 'Bulk import pharmacy inventory from CSV — solves onboarding friction',
    description:
      'Upload up to 500 products in one step. Each row is auto-mapped via the normalization ' +
      'engine. Existing items are updated; new items are created. Returns full import report.',
  })
  importInventory(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('No file uploaded');
    return this.importService.importCsv(user.tenantId, file.buffer);
  }

  @Get('products/barcode/:barcode')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({
    summary: 'Barcode lookup — find or auto-populate product from barcode/GTIN',
    description:
      'Checks local DB first. Falls back to Open Food Facts global database. ' +
      'If found in local DB, returns productId ready to use. ' +
      'If found externally, returns pre-filled form data to confirm before saving.',
  })
  lookupBarcode(@Param('barcode') barcode: string) {
    return this.barcodeSvc.lookup(barcode.replace(/\s/g, ''));
  }

  @Get('products')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN, Role.SYSTEM_ADMIN)
  @ApiOperation({
    summary: 'Search the product master catalog',
    description: 'Supports fuzzy search by name, generic name, active ingredient, or exact barcode.',
  })
  @ApiOkResponse({ description: '{ data: Product[], total: number }' })
  findAllProducts(
    @Query('search') search?: string,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take = 50,
    @Query('skip', new DefaultValuePipe(0),  ParseIntPipe) skip = 0,
  ) {
    return this.inventoryService.findAllProducts(search, take, skip);
  }

  @Post('products')
  @Roles(Role.SYSTEM_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({
    summary: 'Create a new product in the master catalog',
    description:
      'System admin creates verified products. ' +
      'Supplier admin can also create products — they are flagged as requiresMapping=true ' +
      'until a system admin maps them to a canonical product via /normalization.',
  })
  @ApiCreatedResponse({ description: 'Product created successfully' })
  createProduct(@CurrentUser() user: any, @Body() dto: CreateProductDto) {
    // Products created by suppliers are unverified until mapped
    if (user.role === Role.SUPPLIER_ADMIN) {
      return this.inventoryService.createProduct({ ...dto, requiresMapping: true });
    }
    return this.inventoryService.createProduct(dto);
  }
}

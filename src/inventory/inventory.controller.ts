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
  ConflictException,
  BadRequestException,
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
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InventoryService } from './inventory.service';
import { InventoryImportService } from './inventory-import.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import { BatchesService } from './batches.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { CatalogMatchingService } from './catalog-matching.service';
import { ImportBatchService } from './import-batch.service';
import {
  MATCH_QUEUE,
  MATCH_TENANT_JOB,
} from './match.constants';

@ApiTags('inventory')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly importService: InventoryImportService,
    private readonly barcodeSvc: BarcodeLookupService,
    private readonly batchesService: BatchesService,
    private readonly matchingService: CatalogMatchingService,
    private readonly importBatches: ImportBatchService,
    @InjectQueue(MATCH_QUEUE) private readonly matchQueue: Queue,
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
    description: 'CSV file. Headers: productName, genericName, category, unit, quantity, minThreshold, expiryDate, barcode, manufacturer, strength, dosageForm, nameAr',
  })
  @ApiOperation({
    summary: 'Bulk import pharmacy inventory from CSV (asynchronous)',
    description:
      'Two-phase pipeline: parses + validates the CSV synchronously (under 5 s for any size), ' +
      'creates an ImportBatch, stages rows, and enqueues an AI-matching worker job. ' +
      'Returns { batchId, total } immediately. The frontend polls GET /inventory/imports/:id ' +
      'for live progress and final counters (autoLinked, suggested, unlinked).',
  })
  @ApiCreatedResponse({ description: '{ batchId: string, total: number }' })
  async importInventory(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.ingestCsv(user.tenantId, user.id ?? null, file);
  }

  // ── Import progress & history (async batch UI) ──────────────────────────────

  @Get('inventory/imports')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'List recent inventory import batches for the current pharmacy',
    description:
      'Returns up to 20 batches (CSV uploads, Smart Link runs, admin cascades), newest first. ' +
      'Drives the upload-history sidebar so the user can see past results without re-uploading.',
  })
  @ApiOkResponse({ description: 'Array of ImportBatch records' })
  listImports(@CurrentUser() user: any) {
    return this.importBatches.listForTenant(user.tenantId);
  }

  @Get('inventory/imports/:id')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Get live progress + counters of one import batch',
    description:
      'Polled every 2 s by the frontend ImportProgressToast to drive the live progress bar. ' +
      'Returns the full ImportBatch including counters, errors, and status transitions.',
  })
  @ApiOkResponse({ description: 'ImportBatch with current counters and status' })
  @ApiNotFoundResponse({ description: 'Batch not found' })
  @ApiForbiddenResponse({ description: 'Batch belongs to a different pharmacy' })
  getImport(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.importBatches.getForTenant(user.tenantId, id);
  }

  @Post('inventory/imports/:id/cancel')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Cancel an in-flight import batch',
    description:
      'Flips status → cancelled, drops pending staged rows. The worker checks status before each ' +
      'chunk and exits cleanly. Already-processed rows stay in inventory.',
  })
  @ApiOkResponse({ description: 'Updated ImportBatch (status=cancelled)' })
  cancelImport(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.importBatches.cancel(user.tenantId, id);
  }

  // ── Batches (per-lot tracking) ───────────────────────────────────────────────

  @Get('inventory/:id/batches')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'List all batches/lots for an inventory item (FEFO order)',
    description: 'Returns active batches sorted by soonest expiry date for traceability and dispensing.',
  })
  @ApiOkResponse({ description: 'Array of ProductBatch records' })
  @ApiNotFoundResponse({ description: 'Inventory item not found' })
  listBatches(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.batchesService.listForItem(user.tenantId, id);
  }

  @Post('inventory/:id/batches')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Receive a new batch/lot for an inventory item',
    description:
      'Creates a new ProductBatch row, then recomputes the parent inventory item: ' +
      'quantity = SUM(active batches), batchNumber/expiryDate/sellingPrice = soonest-expiry (FEFO) lot, ' +
      'costPrice = weighted average across active lots.',
  })
  @ApiCreatedResponse({ description: '{ batch, inventory }' })
  @ApiNotFoundResponse({ description: 'Inventory item not found' })
  @ApiForbiddenResponse({ description: 'Item belongs to a different pharmacy' })
  addBatch(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBatchDto,
  ) {
    return this.batchesService.create(user.tenantId, user.id, id, dto);
  }

  @Post('batches/:batchId/adjust')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Adjust quantity of a single batch (stock-in or stock-out delta)',
    description:
      'delta > 0 increases the batch (e.g. correcting a count); ' +
      'delta < 0 decreases it (e.g. wastage / manual stock-out). ' +
      'Recomputes the parent inventory aggregate (quantity, FEFO batchNumber/expiry, weighted cost).',
  })
  @ApiOkResponse({ description: '{ batch, inventory }' })
  @ApiNotFoundResponse({ description: 'Batch not found' })
  @ApiForbiddenResponse({ description: 'Batch belongs to a different pharmacy' })
  adjustBatch(
    @CurrentUser() user: any,
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() body: { delta: number; reason?: string },
  ) {
    return this.batchesService.adjustQuantity(
      user.tenantId,
      user.id,
      batchId,
      Number(body?.delta) || 0,
      body?.reason,
    );
  }

  @Patch('batches/:batchId')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Update editable fields of a batch (metadata only)' })
  @ApiOkResponse({ description: '{ batch, inventory }' })
  @ApiNotFoundResponse({ description: 'Batch not found' })
  updateBatch(
    @CurrentUser() user: any,
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() body: {
      batchNumber?: string;
      expiryDate?: string | null;
      location?: string | null;
      costPerUnit?: number;
      sellingPrice?: number;
      notes?: string | null;
    },
  ) {
    return this.batchesService.updateBatch(user.tenantId, user.id, batchId, body);
  }

  @Delete('batches/:batchId')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Soft-delete (depleted) a batch and recompute parent' })
  @ApiOkResponse({ description: '{ inventory }' })
  @ApiNotFoundResponse({ description: 'Batch not found' })
  removeBatch(
    @CurrentUser() user: any,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    return this.batchesService.removeBatch(user.tenantId, user.id, batchId);
  }

  // ── Catalog linking ────────────────────────────────────────────────────────
  @Get('inventory/:id/match-candidates')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Get AI-ranked catalog candidates for an inventory item',
    description: 'Returns scored matches with explanation signals (barcode, name, manufacturer, strength, dosage form).',
  })
  @ApiOkResponse({ description: 'Array of MatchCandidate objects sorted by score desc' })
  async getMatchCandidates(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('name')         name?: string,
    @Query('nameAr')       nameAr?: string,
    @Query('barcode')      barcode?: string,
    @Query('manufacturer') manufacturer?: string,
    @Query('strength')     strength?: string,
    @Query('dosageForm')   dosageForm?: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    const candidates = await this.matchingService.candidatesForInventoryItem(
      user.tenantId,
      id,
      { name, nameAr, barcode, manufacturer, strength, dosageForm },
      limit,
    );
    return candidates.map(c => ({
      productId:    c.product.id,
      product:      c.product,
      score:        c.score,
      signals:      c.signals,
      reasons:      c.reasons,
    }));
  }

  @Post('inventory/:id/link')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Link an inventory item to a specific catalog product' })
  @ApiOkResponse({ description: 'Updated inventory item with linkStatus=linked' })
  linkInventoryItem(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { productId: string; score?: number; signals?: string[]; reasons?: string[] },
  ) {
    return this.inventoryService.linkToProduct(
      user.tenantId,
      id,
      body.productId,
      { score: body.score, signals: body.signals, reasons: body.reasons, manual: true },
    );
  }

  @Post('inventory/:id/unlink')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Detach an inventory item from its catalog link' })
  @ApiOkResponse({ description: 'Updated inventory item with linkStatus=unlinked' })
  unlinkInventoryItem(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.inventoryService.unlinkFromCatalog(user.tenantId, id, body?.reason);
  }

  @Post('inventory/run-matching')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Smart Link — re-run AI matching across all unlinked items (asynchronous)',
    description:
      'Creates a tenant_rematch ImportBatch and enqueues a worker job. Same progress endpoint ' +
      '(GET /inventory/imports/:id) drives the wizard UI. Returns { batchId } immediately so the ' +
      'user can keep working while the worker drains the unlinked items.',
  })
  @ApiCreatedResponse({ description: '{ batchId: string, total: number }' })
  async runMatching(@CurrentUser() user: any) {
    // Count unlinked items to seed the batch.total so the progress bar has
    // a denominator from the start. Worker reads the actual rows page-by-page.
    const totalUnlinked = await this.inventoryService.countUnlinked(user.tenantId);
    const batch = await this.importBatches.create({
      tenantId:   user.tenantId,
      userId:     user.id ?? null,
      kind:       'tenant_rematch',
      sourceFile: null,
      total:      totalUnlinked,
    });

    await this.matchQueue.add(
      MATCH_TENANT_JOB,
      { batchId: batch.id, tenantId: user.tenantId },
      {
        jobId: `rematch-${batch.id}`,
        removeOnComplete: { age: 86_400 },
        removeOnFail:     { age: 604_800 },
        attempts:         3,
        backoff:          { type: 'exponential', delay: 5_000 },
      },
    );
    return { batchId: batch.id, total: totalUnlinked };
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
  @Roles(Role.SYSTEM_ADMIN, Role.SUPPLIER_ADMIN, Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Create a new product in the master catalog',
    description:
      'System admin creates verified products. ' +
      'Supplier and pharmacy admins can also create products — they are flagged as requiresMapping=true ' +
      'until a system admin maps them to a canonical product via /normalization.',
  })
  @ApiCreatedResponse({ description: 'Product created successfully' })
  async createProduct(@CurrentUser() user: any, @Body() dto: CreateProductDto) {
    // Pre-creation similarity gate: stop pharmacy/supplier admins from
    // accidentally re-creating a product that already exists in the verified
    // catalog. System admins are trusted (they curate the catalog).
    // The gate is skipped when the caller explicitly opts in via forceCreate,
    // which the frontend sends only after showing the user the suggested
    // existing products and getting confirmation.
    const isAdminCreator =
      user.role === Role.SUPPLIER_ADMIN || user.role === Role.PHARMACY_ADMIN;
    if (isAdminCreator && !dto.forceCreate) {
      const candidates = await this.matchingService.findCandidates(
        {
          name: dto.name,
          nameAr: dto.nameAr,
          barcode: dto.barcode,
          manufacturer: dto.manufacturer,
          strength: dto.strength,
          dosageForm: dto.dosageForm,
        },
        5,
      );
      const strong = candidates.filter((c) => c.score >= 85);
      if (strong.length > 0) {
        throw new ConflictException({
          code: 'SIMILAR_PRODUCT_EXISTS',
          message:
            'يوجد منتج مشابه بالفعل في الكتالوج. راجع الاقتراحات قبل إنشاء منتج جديد.',
          requiresForceCreate: true,
          candidates: strong.map((c) => ({
            productId: c.product.id,
            score: c.score,
            signals: c.signals,
            reasons: c.reasons,
            product: {
              id: c.product.id,
              name: c.product.name,
              nameAr: c.product.nameAr,
              manufacturer: c.product.manufacturer,
              strength: c.product.strength,
              dosageForm: c.product.dosageForm,
              barcode: c.product.barcode,
            },
          })),
        });
      }
    }

    // Products created by non-system admins are unverified until mapped
    if (isAdminCreator) {
      return this.inventoryService.createProduct({ ...dto, requiresMapping: true });
    }
    return this.inventoryService.createProduct(dto);
  }
}

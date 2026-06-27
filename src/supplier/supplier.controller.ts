import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { SupplierService } from './supplier.service';
import { MarketAvailabilityService } from './market-availability.service';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from '../audit/decorators/audit-read.decorator';

@ApiTags('supplier')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('supplier')
export class SupplierController {
  constructor(
    private readonly supplierService: SupplierService,
    private readonly marketAvailability: MarketAvailabilityService,
  ) {}

  @Get('catalog')
  @AuditRead('supplier_catalog')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({
    summary: 'Get supplier catalog (paginated) — pharmacy admin sees all items, supplier admin sees their own',
  })
  @ApiOkResponse({ description: '{ data, total, limit, offset } — default 25 per page' })
  getCatalog(
    @CurrentUser() user: any,
    @Query() query: CatalogQueryDto,
  ) {
    if (user.role === Role.SUPPLIER_ADMIN) {
      return this.supplierService.findMyCatalog(user.tenantId, {
        limit: query.limit,
        offset: query.offset,
      });
    }
    const { search, supplierId, ...pagination } = query;
    return this.supplierService.findAllCatalog(pagination, search, supplierId);
  }

  @Post('catalog')
  @Roles(Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Add a product to supplier catalog with price and availability' })
  @ApiCreatedResponse({ description: 'Catalog item created successfully' })
  create(@CurrentUser() user: any, @Body() dto: CreateCatalogItemDto) {
    return this.supplierService.create(user.tenantId, dto);
  }

  @Patch('catalog/:id')
  @Roles(Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Update price, availability or stock for a catalog item' })
  @ApiOkResponse({ description: 'Catalog item updated successfully' })
  @ApiNotFoundResponse({ description: 'Catalog item not found' })
  @ApiForbiddenResponse({ description: 'Item belongs to a different supplier' })
  update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.supplierService.update(user.tenantId, id, dto);
  }

  @Delete('catalog/:id')
  @Roles(Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Soft-delete a catalog item' })
  @ApiOkResponse({ description: 'Catalog item deleted successfully' })
  @ApiNotFoundResponse({ description: 'Catalog item not found' })
  @ApiForbiddenResponse({ description: 'Item belongs to a different supplier' })
  remove(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.supplierService.remove(user.tenantId, id);
  }

  // ─── MARKET AVAILABILITY ─────────────────────────────────────────────────────

  @Get('market-availability')
  @Roles(Role.PHARMACY_ADMIN, Role.SYSTEM_ADMIN)
  @ApiOperation({
    summary: 'Current market availability for a product',
    description:
      'Returns the availability rate (0–1) across all suppliers. ' +
      'Includes 30-day trend. Rate < 50% = shortage risk (triggers R3 in Orchestrator).',
  })
  @ApiOkResponse({ description: '{ latest, trend[] }' })
  async getMarketAvailability(@Query('productId', ParseUUIDPipe) productId: string) {
    const [latest, trend] = await Promise.all([
      this.marketAvailability.getLatest(productId),
      this.marketAvailability.getTrend(productId, 30),
    ]);
    return { latest, trend };
  }

  @Get('market-availability/at-risk')
  @Roles(Role.PHARMACY_ADMIN, Role.SYSTEM_ADMIN)
  @ApiOperation({
    summary: 'Top at-risk products (availability < 50%)',
    description: 'Used by AI Center DashboardTab to surface proactive shortage alerts.',
  })
  @ApiOkResponse({ description: 'Array of MarketAvailabilityResult' })
  getAtRiskProducts() {
    return this.marketAvailability.getAtRiskProducts(10);
  }
}

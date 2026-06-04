import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
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
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
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
  constructor(private readonly supplierService: SupplierService) {}

  @Get('catalog')
  @AuditRead('supplier_catalog')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({
    summary: 'Get supplier catalog — pharmacy admin sees all available items; supplier admin sees their own',
  })
  @ApiOkResponse({ description: 'Returns catalog items based on caller role' })
  getCatalog(@CurrentUser() user: any) {
    if (user.role === Role.SUPPLIER_ADMIN) {
      return this.supplierService.findMyCatalog(user.tenantId);
    }
    return this.supplierService.findAllCatalog();
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
}

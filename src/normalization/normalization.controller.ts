import {
  Controller,
  Get,
  Post,
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
} from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional } from 'class-validator';
import { ProductNormalizationService } from './product-normalization.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

class MapSkuDto {
  @IsUUID()
  supplierTenantId: string;

  @IsString()
  supplierSku: string;

  @IsUUID()
  canonicalProductId: string;

  @IsOptional()
  @IsString()
  supplierName?: string;
}

@ApiTags('normalization')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('normalization')
export class NormalizationController {
  constructor(private readonly svc: ProductNormalizationService) {}

  @Get('unmapped')
  @ApiOperation({ summary: 'List products flagged as requiring canonical mapping (system admin)' })
  @ApiOkResponse()
  getUnmapped() {
    return this.svc.getUnmappedProducts();
  }

  @Post('map')
  @ApiOperation({ summary: 'Map a supplier SKU to a canonical product (system admin)' })
  @ApiCreatedResponse({ description: 'Alias created or updated' })
  map(@Body() dto: MapSkuDto) {
    return this.svc.mapSupplierSku(
      dto.supplierTenantId,
      dto.supplierSku,
      dto.canonicalProductId,
      dto.supplierName,
    );
  }

  @Get('products/:id/aliases')
  @ApiOperation({ summary: 'List all supplier aliases for a canonical product' })
  @ApiOkResponse()
  getAliases(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getProductAliases(id);
  }
}

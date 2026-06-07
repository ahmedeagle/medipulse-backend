import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { SupplierProfileService } from './supplier-profile.service';
import { PreferredSupplierService } from './preferred-supplier.service';
import { CatalogImportService } from './catalog-import.service';
import { AnalyticsReadService } from '../analytics/analytics-read.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from '../audit/decorators/audit-read.decorator';
import { ProfileStatus } from './entities/supplier-profile.entity';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';

class UpsertProfileDto {
  @IsString()  companyName:     string;
  @IsOptional() @IsString()  registrationNumber?: string;
  @IsOptional() @IsString()  licenseNumber?:      string;
  @IsOptional()              licenseExpiryDate?:  Date;
  @IsOptional() @IsString()  address?:            string;
  @IsOptional() @IsString()  phone?:              string;
  @IsOptional() @IsString()  website?:            string;
  @IsOptional()              deliveryZones?:      string[];
  @IsOptional() @Type(() => Number) minOrderAmount?: number;
  @IsOptional() @Type(() => Number) maxDeliveryDays?: number;
  @IsOptional() @IsString()  paymentTerms?:       string;
  @IsOptional()              certifications?:     any[];
}

class ConnectSupplierDto {
  @IsString()
  supplierTenantId: string;

  @IsOptional() @IsInt() @Min(1) @Max(10)
  priority?: number;

  @IsOptional() @IsString()
  notes?: string;
}

class RejectProfileDto {
  @IsString()
  reason: string;
}

// ─── Supplier: manage own profile ────────────────────────────────────────────

@ApiTags('supplier-network')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('supplier/profile')
export class SupplierProfileController {
  constructor(private readonly profileSvc: SupplierProfileService) {}

  @Get()
  @Roles(Role.SUPPLIER_ADMIN)
  @AuditRead('supplier_profile')
  @ApiOperation({ summary: 'Get own supplier profile' })
  getOwn(@CurrentUser() user: any) {
    return this.profileSvc.getOwn(user.tenantId);
  }

  @Post()
  @Roles(Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Create or update own supplier profile — triggers re-verification' })
  upsert(@CurrentUser() user: any, @Body() dto: UpsertProfileDto) {
    return this.profileSvc.upsert(user.tenantId, dto);
  }

  @Get('all')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @AuditRead('supplier_profiles')
  @ApiOperation({ summary: 'Browse verified supplier profiles (paginated, pharmacy / chain admin)' })
  findAll(@Query() pagination: PaginationQueryDto) {
    return this.profileSvc.findAll('verified', pagination);
  }

  @Get(':supplierTenantId')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @AuditRead('supplier_profile')
  @ApiOperation({ summary: 'View a specific supplier profile' })
  findOne(@Param('supplierTenantId', ParseUUIDPipe) id: string) {
    return this.profileSvc.findById(id);
  }
}

// ─── Admin: verify supplier profiles ────────────────────────────────────────

@ApiTags('supplier-network')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/supplier-profiles')
export class SupplierProfileAdminController {
  constructor(private readonly profileSvc: SupplierProfileService) {}

  @Get()
  @ApiOperation({ summary: 'List supplier profiles (paginated, system admin)' })
  findAll(
    @Query('status') status?: ProfileStatus,
    @Query() pagination?: PaginationQueryDto,
  ) {
    return this.profileSvc.findAll(status, pagination);
  }

  @Patch(':supplierTenantId/verify')
  @ApiOperation({ summary: 'Verify a supplier profile — enables higher recommendation ranking' })
  verify(@Param('supplierTenantId', ParseUUIDPipe) id: string) {
    return this.profileSvc.verify(id);
  }

  @Patch(':supplierTenantId/reject')
  @ApiOperation({ summary: 'Reject a supplier profile with a reason' })
  reject(@Param('supplierTenantId', ParseUUIDPipe) id: string, @Body() dto: RejectProfileDto) {
    return this.profileSvc.reject(id, dto.reason);
  }

  @Patch(':supplierTenantId/suspend')
  @ApiOperation({ summary: 'Suspend a supplier' })
  suspend(@Param('supplierTenantId', ParseUUIDPipe) id: string) {
    return this.profileSvc.suspend(id);
  }
}

// ─── Pharmacy: preferred supplier connections ─────────────────────────────────

@ApiTags('supplier-network')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('connections')
export class PreferredSupplierController {
  constructor(private readonly preferredSvc: PreferredSupplierService) {}

  @Get()
  @AuditRead('preferred_suppliers')
  @ApiOperation({ summary: 'List preferred suppliers for this pharmacy (ordered by priority)' })
  list(@CurrentUser() user: any) {
    return this.preferredSvc.listForPharmacy(user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Connect with a supplier (sets preference for recommendations)' })
  connect(@CurrentUser() user: any, @Body() dto: ConnectSupplierDto) {
    return this.preferredSvc.connect(user.tenantId, dto.supplierTenantId, dto.priority, dto.notes);
  }

  @Delete(':supplierTenantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove supplier from preferred list' })
  disconnect(@CurrentUser() user: any, @Param('supplierTenantId', ParseUUIDPipe) sid: string) {
    return this.preferredSvc.disconnect(user.tenantId, sid);
  }
}

// ─── Supplier: bulk catalog import ───────────────────────────────────────────

@ApiTags('supplier-network')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPPLIER_ADMIN)
@Controller('supplier/catalog')
export class CatalogImportController {
  constructor(private readonly importSvc: CatalogImportService) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'CSV file with headers: productName, genericName, category, unit, price, currency, stock, supplierSku' })
  @ApiOperation({
    summary: 'Bulk import supplier catalog from CSV',
    description:
      'Returns { total, imported, skipped, unmapped, errors[] }. ' +
      'Products are auto-mapped via normalization engine. ' +
      'Unmapped items are flagged for admin review.',
  })
  async importCsv(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new Error('No file uploaded');
    return this.importSvc.importCsv(user.tenantId, file.buffer);
  }
}

// ─── Supplier: demand signals ────────────────────────────────────────────────

@ApiTags('supplier-network')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPPLIER_ADMIN)
@Controller('supplier/demand-signals')
export class DemandSignalsController {
  constructor(
    private readonly profileSvc: SupplierProfileService,
    private readonly analyticsSvc: AnalyticsReadService,
  ) {}

  @Get()
  @AuditRead('demand_signals')
  @ApiOperation({
    summary: 'Anonymized demand signals in supplier\'s delivery zones',
    description:
      'Shows which products pharmacies in your delivery zones are running low on. ' +
      'Fully anonymized — only product + severity + region + count shown, never specific pharmacies.',
  })
  async getDemandSignals(@CurrentUser() user: any) {
    const profile = await this.profileSvc.getOwn(user.tenantId);
    const zones = profile?.deliveryZones ?? [];
    return this.analyticsSvc.getDemandSignalsForSupplier(user.tenantId, zones);
  }
}

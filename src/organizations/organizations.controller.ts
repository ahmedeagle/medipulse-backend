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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { IsString, IsIn, IsOptional } from 'class-validator';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { OrganizationType } from './entities/organization.entity';
import { AuditRead } from '../audit/decorators/audit-read.decorator';

class CreateOrganizationDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsIn(['chain', 'hospital_network', 'group'])
  type: OrganizationType;
}

class AddBranchDto {
  @IsString()
  tenantId: string;

  @IsOptional()
  @IsIn(['branch', 'central'])
  branchRole?: 'branch' | 'central';
}

// ─── System Admin Routes ──────────────────────────────────────────────────────

@ApiTags('organizations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly svc: OrganizationsService) {}

  @Post()
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Create an organization (pharmacy chain / hospital network)' })
  @ApiCreatedResponse()
  create(@Body() dto: CreateOrganizationDto) {
    return this.svc.create(dto);
  }

  @Get()
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'List all organizations (system admin)' })
  @ApiOkResponse()
  findAll() {
    return this.svc.findAll();
  }

  @Post(':id/branches')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Add a tenant as a branch of this organization' })
  @ApiCreatedResponse()
  addBranch(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Body() dto: AddBranchDto,
  ) {
    return this.svc.addBranch(orgId, dto.tenantId, dto.branchRole);
  }

  @Delete(':id/branches/:tenantId')
  @Roles(Role.SYSTEM_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a tenant from this organization' })
  removeBranch(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.svc.removeBranch(tenantId);
  }
}

// ─── Chain Admin Routes — cross-branch views ─────────────────────────────────

@ApiTags('organizations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CHAIN_ADMIN)
@Controller('org')
export class ChainAdminController {
  constructor(private readonly svc: OrganizationsService) {}

  @Get('branches')
  @ApiOperation({ summary: 'List all branches in this chain (chain admin)' })
  @ApiOkResponse()
  getBranches(@CurrentUser() user: any) {
    return this.svc.getBranches(user.organizationId);
  }

  @Get('inventory/aggregated')
  @AuditRead('org_inventory')
  @ApiOperation({
    summary: 'Cross-branch inventory — low-stock items across all branches',
    description: 'Returns branches that have items at or below minimum threshold, ordered by quantity ascending.',
  })
  @ApiOkResponse()
  getAggregatedInventory(@CurrentUser() user: any) {
    return this.svc.getAggregatedInventory(user.organizationId);
  }

  @Get('orders')
  @AuditRead('org_orders')
  @ApiOperation({ summary: 'All orders across all branches (chain admin)' })
  @ApiOkResponse()
  getOrders(@CurrentUser() user: any) {
    return this.svc.getAggregatedOrders(user.organizationId);
  }

  @Get('analytics/spend')
  @ApiOperation({
    summary: 'Spend analytics by branch — last 90 days of delivered orders',
    description: 'Shows totalSpend and orderCount per branch. Useful for central procurement reporting.',
  })
  @ApiOkResponse()
  getSpend(@CurrentUser() user: any) {
    return this.svc.getSpendAnalytics(user.organizationId);
  }
}

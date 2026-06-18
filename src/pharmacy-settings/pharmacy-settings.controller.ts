import {
  Controller, Get, Patch, Post, Delete,
  Body, Param, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { PharmacySettingsService } from './pharmacy-settings.service';
import { UpsertPharmacySettingsDto, CreateWarehouseDto, UpdateWarehouseDto } from './dto/upsert-settings.dto';

@ApiTags('pharmacy-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class PharmacySettingsController {
  constructor(private readonly svc: PharmacySettingsService) {}

  // ── Settings ─────────────────────────────────────────────────────────────────

  @Get('pharmacy/settings')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Get pharmacy settings' })
  getSettings(@CurrentUser() user: { tenantId: string }) {
    return this.svc.getSettings(user.tenantId);
  }

  @Patch('pharmacy/settings')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Update pharmacy settings (partial)' })
  upsertSettings(
    @CurrentUser() user: { tenantId: string },
    @Body() dto: UpsertPharmacySettingsDto,
  ) {
    return this.svc.upsertSettings(user.tenantId, dto);
  }

  // ── Warehouses ───────────────────────────────────────────────────────────────

  @Get('pharmacy/warehouses')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'List warehouses' })
  listWarehouses(@CurrentUser() user: { tenantId: string }) {
    return this.svc.getWarehouses(user.tenantId);
  }

  @Post('pharmacy/warehouses')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Create warehouse' })
  createWarehouse(
    @CurrentUser() user: { tenantId: string },
    @Body() dto: CreateWarehouseDto,
  ) {
    return this.svc.createWarehouse(user.tenantId, dto);
  }

  @Patch('pharmacy/warehouses/:id')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Update warehouse' })
  updateWarehouse(
    @CurrentUser() user: { tenantId: string },
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.svc.updateWarehouse(user.tenantId, id, dto);
  }

  @Delete('pharmacy/warehouses/:id')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Delete warehouse' })
  deleteWarehouse(
    @CurrentUser() user: { tenantId: string },
    @Param('id') id: string,
  ) {
    return this.svc.deleteWarehouse(user.tenantId, id);
  }
}

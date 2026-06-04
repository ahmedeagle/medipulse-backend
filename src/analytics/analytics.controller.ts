import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AnalyticsReadService } from './analytics-read.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from '../audit/decorators/audit-read.decorator';

@ApiTags('analytics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsReadService) {}

  @Get('dashboard')
  @Roles(Role.PHARMACY_ADMIN)
  @AuditRead('analytics_dashboard')
  @ApiOperation({ summary: 'Weekly analytics snapshots for this pharmacy (last 12 weeks)' })
  @ApiQuery({ name: 'weeks', required: false, schema: { default: 12 } })
  @ApiOkResponse({ description: 'Weekly analytics snapshot array' })
  getDashboard(
    @CurrentUser() user: any,
    @Query('weeks', new DefaultValuePipe(12), ParseIntPipe) weeks: number,
  ) {
    return this.svc.getWeeklySnapshots(user.tenantId, Math.min(weeks, 52));
  }

  @Get('pricing/regional')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN, Role.CHAIN_ADMIN, Role.SYSTEM_ADMIN)
  @AuditRead('regional_pricing')
  @ApiOperation({
    summary: 'Current prices for a product across all suppliers with region breakdown',
    description: 'Powered by PriceSnapshot — includes 30-day price change % per supplier.',
  })
  @ApiQuery({ name: 'productId', required: true })
  @ApiOkResponse()
  getRegionalPricing(@Query('productId', ParseUUIDPipe) productId: string) {
    return this.svc.getRegionalPricing(productId);
  }

  @Get('pricing/trend')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN, Role.CHAIN_ADMIN, Role.SYSTEM_ADMIN)
  @AuditRead('pricing_trend')
  @ApiOperation({
    summary: 'Price trend for a product from a specific supplier over N days',
    description: 'Shows every price change recorded. Useful for detecting price volatility.',
  })
  @ApiQuery({ name: 'productId',        required: true })
  @ApiQuery({ name: 'supplierTenantId', required: true })
  @ApiQuery({ name: 'days',             required: false, schema: { default: 90 } })
  @ApiOkResponse()
  getPriceTrend(
    @Query('productId',        ParseUUIDPipe) productId: string,
    @Query('supplierTenantId', ParseUUIDPipe) supplierTenantId: string,
    @Query('days', new DefaultValuePipe(90), ParseIntPipe) days: number,
  ) {
    return this.svc.getPriceTrend(supplierTenantId, productId, Math.min(days, 365));
  }
}

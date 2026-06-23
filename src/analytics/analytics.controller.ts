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

  @Get('diag')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Diagnostic: counts from all report-relevant tables' })
  getDiag(@CurrentUser() user: any) {
    return this.svc.getDataDiag(user.tenantId);
  }

  @Get('sales/summary')
  @Roles(Role.PHARMACY_ADMIN)
  @AuditRead('sales_summary_report')
  @ApiOperation({ summary: 'Aggregated daily, weekly, or monthly sales summary with COGS and margin' })
  @ApiQuery({ name: 'granularity',  required: false, enum: ['daily', 'weekly', 'monthly'], schema: { default: 'daily' } })
  @ApiQuery({ name: 'dateFrom',     required: true,  description: 'ISO date YYYY-MM-DD' })
  @ApiQuery({ name: 'dateTo',       required: true,  description: 'ISO date YYYY-MM-DD (inclusive)' })
  @ApiQuery({ name: 'cashierName',  required: false, description: 'Filter by cashier name (partial, case-insensitive)' })
  getSalesSummary(
    @CurrentUser() user: any,
    @Query('granularity')  granularity:  string = 'daily',
    @Query('dateFrom')     dateFrom:     string,
    @Query('dateTo')       dateTo:       string,
    @Query('cashierName')  cashierName?: string,
  ) {
    const g = granularity === 'monthly' ? 'monthly' : granularity === 'weekly' ? 'weekly' : 'daily';
    return this.svc.getSalesSummary(user.tenantId, { granularity: g, dateFrom, dateTo, cashierName });
  }

  @Get('sales/by-product')
  @Roles(Role.PHARMACY_ADMIN)
  @AuditRead('sales_by_product_report')
  @ApiOperation({ summary: 'Sales breakdown by product per day with COGS and margin' })
  @ApiQuery({ name: 'dateFrom',  required: true })
  @ApiQuery({ name: 'dateTo',    required: true })
  @ApiQuery({ name: 'search',    required: false })
  @ApiQuery({ name: 'category',  required: false })
  getSalesByProduct(
    @CurrentUser() user: any,
    @Query('dateFrom')  dateFrom:  string,
    @Query('dateTo')    dateTo:    string,
    @Query('search')    search?:   string,
    @Query('category')  category?: string,
  ) {
    return this.svc.getSalesByProduct(user.tenantId, { dateFrom, dateTo, search, category });
  }

  @Get('sales/diag')
  @Roles(Role.PHARMACY_ADMIN)
  diagSalesByProduct(@CurrentUser() user: any) {
    return this.svc.diagSalesByProduct(user.tenantId);
  }

  @Get('inventory/current')
  @Roles(Role.PHARMACY_ADMIN)
  @AuditRead('inventory_report')
  @ApiOperation({ summary: 'Current inventory snapshot with cost/sell values, expiry status and discount stats' })
  @ApiQuery({ name: 'search',   required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'status',   required: false, enum: ['active', 'near_expiry', 'expired', 'low_stock'] })
  getInventoryReport(
    @CurrentUser() user: any,
    @Query('search')   search?:   string,
    @Query('category') category?: string,
    @Query('status')   status?:   string,
  ) {
    return this.svc.getInventoryReport(user.tenantId, { search, category, status });
  }

  @Get('expiry/report')
  @Roles(Role.PHARMACY_ADMIN)
  @AuditRead('expiry_report')
  @ApiOperation({ summary: 'Per-batch expiry report sorted ascending by expiry date' })
  @ApiQuery({ name: 'search',    required: false })
  @ApiQuery({ name: 'category',  required: false })
  @ApiQuery({ name: 'status',    required: false, enum: ['expired', 'near_expiry', 'active'] })
  @ApiQuery({ name: 'daysAhead', required: false })
  @ApiQuery({ name: 'dateFrom',  required: false, description: 'Expiry date from (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateTo',    required: false, description: 'Expiry date to (YYYY-MM-DD)' })
  getExpiryReport(
    @CurrentUser() user: any,
    @Query('search')    search?:    string,
    @Query('category')  category?:  string,
    @Query('status')    status?:    string,
    @Query('daysAhead') daysAhead?: string,
    @Query('dateFrom')  dateFrom?:  string,
    @Query('dateTo')    dateTo?:    string,
  ) {
    return this.svc.getExpiryReport(user.tenantId, {
      search, category, status, dateFrom, dateTo,
      daysAhead: daysAhead !== undefined ? Number(daysAhead) : undefined,
    });
  }

  @Get('insurance/claims')
  @Roles(Role.PHARMACY_ADMIN)
  @AuditRead('insurance_claims_report')
  @ApiOperation({ summary: 'Insurance claims summary grouped by date and company' })
  @ApiQuery({ name: 'dateFrom',           required: false })
  @ApiQuery({ name: 'dateTo',             required: false })
  @ApiQuery({ name: 'insuranceCompanyId', required: false })
  getInsuranceClaimsReport(
    @CurrentUser() user: any,
    @Query('dateFrom')           dateFrom?:           string,
    @Query('dateTo')             dateTo?:             string,
    @Query('insuranceCompanyId') insuranceCompanyId?: string,
  ) {
    return this.svc.getInsuranceClaimsReport(user.tenantId, {
      dateFrom, dateTo, insuranceCompanyId,
    });
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

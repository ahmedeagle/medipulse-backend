import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { DemandForecastingService } from './demand-forecasting.service';
import { EoqService } from './eoq.service';
import { ProphetShadowService } from './prophet-shadow.service';
import { DeadStockService } from '../inventory/dead-stock.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from '../audit/decorators/audit-read.decorator';
import { HijriCalendar } from '../common/utils/hijri-calendar';

@ApiTags('forecasting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('forecasting')
export class ForecastingController {
  constructor(
    private readonly forecastingSvc: DemandForecastingService,
    private readonly eoqSvc: EoqService,
    private readonly deadStockSvc: DeadStockService,
    private readonly prophetShadow: ProphetShadowService,
  ) {}

  @Get('demand')
  @AuditRead('demand_forecast')
  @ApiOperation({
    summary: 'Get demand forecast for a product (7, 14, 30 day horizons)',
    description:
      'Uses Holt-Winters Double Exponential Smoothing on weekly consumption snapshots. ' +
      'Returns forecast + confidence interval + trend direction per horizon. ' +
      'Includes retrospective MAPE accuracy where available.',
  })
  @ApiQuery({ name: 'productId', required: true })
  @ApiOkResponse()
  getDemandForecast(
    @CurrentUser() user: any,
    @Query('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.forecastingSvc.getForecasts(user.tenantId, productId);
  }

  @Get('eoq')
  @AuditRead('procurement_schedule')
  @ApiOperation({
    summary: 'Get EOQ + procurement schedule for a product',
    description:
      'Returns Economic Order Quantity, Safety Stock (95% service level), ' +
      'Reorder Point, optimal reorder-by date, and predicted stockout date. ' +
      'Lead time is dynamic — taken from the recommended supplier\'s reliability score.',
  })
  @ApiQuery({ name: 'productId', required: true })
  @ApiOkResponse()
  async getEoqSchedule(
    @CurrentUser() user: any,
    @Query('productId', ParseUUIDPipe) productId: string,
  ) {
    const schedules = await this.eoqSvc.getScheduleMap(user.tenantId, [productId]);
    return schedules.get(productId) ?? null;
  }

  @Get('dead-stock')
  @AuditRead('dead_stock_analysis')
  @ApiOperation({
    summary: 'Dead stock analysis with financial impact and liquidation recommendations',
    description:
      'Identifies products with 8+ weeks of zero movement. ' +
      'Calculates locked capital value per product. ' +
      'Recommends: return_to_supplier | markdown | write_off | monitor. ' +
      'Results ordered by urgency score.',
  })
  @ApiOkResponse()
  getDeadStock(@CurrentUser() user: any) {
    return this.deadStockSvc.analyzeDeadStock(user.tenantId);
  }

  @Get('dead-stock/summary')
  @ApiOperation({ summary: 'Total dead stock value and count for this pharmacy' })
  @ApiOkResponse({ description: '{ value: number, count: number }' })
  getDeadStockSummary(@CurrentUser() user: any) {
    return this.deadStockSvc.getTotalDeadStockValue(user.tenantId);
  }

  @Get('model-accuracy')
  @AuditRead('forecast_model_accuracy')
  @ApiOperation({
    summary: 'Forecasting model validation — Holt-Winters vs Facebook Prophet',
    description:
      'Shows how the live Holt-Winters engine is continuously benchmarked against a ' +
      'shadow Facebook Prophet model on this pharmacy\u2019s own demand. Returns win counts, ' +
      'average forecast error (MAPE %) for each engine, and which model is recommended. ' +
      'Read-only and fail-safe — the shadow comparison never affects live reorder decisions.',
  })
  @ApiOkResponse()
  getModelAccuracy(@CurrentUser() user: any) {
    return this.prophetShadow.getAccuracySummary(user.tenantId);
  }

  @Get('seasonality')
  @ApiOperation({
    summary: 'Active and upcoming seasonal demand events (Hijri-calendar based)',
    description:
      'Returns the currently active demand season (Hajj, Ramadan, school return, etc.) ' +
      'and the next upcoming season within 45 days, each with the affected product ' +
      'categories and their demand multipliers. Requires no sales history — works from day one.',
  })
  @ApiOkResponse()
  getSeasonality() {
    const now = new Date();
    const activeEvent = HijriCalendar.getActiveEvent(now);
    const upcoming = HijriCalendar.getUpcomingEvent(now, 45);

    const toCategories = (key: string) =>
      HijriCalendar.getEventCategoryMultipliers(key).map((c) => ({
        category: c.category,
        multiplier: c.multiplier,
        upliftPct: Math.round((c.multiplier - 1) * 100),
      }));

    return {
      active: activeEvent
        ? {
            event: activeEvent.event,
            arabicName: activeEvent.arabicName,
            categories: toCategories(activeEvent.event),
          }
        : null,
      upcoming: upcoming
        ? {
            event: upcoming.event.event,
            arabicName: upcoming.event.arabicName,
            daysUntil: upcoming.daysUntil,
            categories: toCategories(upcoming.event.event),
          }
        : null,
    };
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Manually trigger forecast + EOQ refresh for this pharmacy',
    description: 'Normally runs automatically (forecasts: Sunday 6am, EOQ: daily 3am). Use for testing.',
  })
  async refreshForecasts(@CurrentUser() user: any) {
    const [forecastCount] = await Promise.all([
      this.forecastingSvc.computeForecasts(user.tenantId),
      this.eoqSvc.refreshForPharmacy(user.tenantId),
    ]);
    return { message: 'Refresh complete', forecastsComputed: forecastCount };
  }
}

import {
  Controller,
  Get,
  Put,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { UpsertNotificationPreferencesDto } from './dto/upsert-notification-preferences.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN, Role.SYSTEM_ADMIN, Role.CHAIN_ADMIN)
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly svc: NotificationService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get notifications for the current user (paginated)' })
  @ApiQuery({ name: 'limit', required: false, schema: { default: 25, maximum: 100 } })
  @ApiOkResponse()
  find(
    @CurrentUser() user: any,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
  ) {
    return this.svc.findForUser(user.tenantId, user.id, Math.min(limit, 100));
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count — used for bell badge' })
  @ApiOkResponse({ description: '{ count: number }' })
  async getUnreadCount(@CurrentUser() user: any) {
    const count = await this.svc.getUnreadCount(user.tenantId, user.id);
    return { count };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.markRead(user.tenantId, user.id, id);
  }

  @Patch('mark-all-read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(@CurrentUser() user: any) {
    return this.svc.markAllRead(user.tenantId, user.id);
  }

  // ── Notification Center: delivery preferences (per pharmacy) ───────────────

  @Get('preferences')
  @ApiOperation({ summary: 'Get the pharmacy notification/delivery preferences' })
  @ApiOkResponse()
  getPreferences(@CurrentUser() user: any) {
    return this.preferences.getTenantDefault(user.tenantId);
  }

  @Put('preferences')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({ summary: 'Update the pharmacy notification/delivery preferences' })
  @ApiOkResponse()
  updatePreferences(
    @CurrentUser() user: any,
    @Body() dto: UpsertNotificationPreferencesDto,
  ) {
    return this.preferences.upsertTenantDefault(user.tenantId, dto);
  }
}

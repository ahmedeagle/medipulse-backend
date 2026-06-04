import {
  Controller,
  Get,
  Post,
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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiBody,
} from '@nestjs/swagger';
import { IsArray, IsString, IsUrl, ArrayMinSize } from 'class-validator';
import { WebhookService } from './webhook.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';

class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  url: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events: string[];
}

@ApiTags('webhooks')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN, Role.SYSTEM_ADMIN)
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @ApiOperation({
    summary: 'Create webhook subscription',
    description: `Valid events: inventory.updated, recommendation.generated, order.status_changed, order.delivered, supplier.stock_changed, stock.risk_detected, ai.governance_blocked, recommendation.dismissed`,
  })
  @ApiCreatedResponse({ description: 'Subscription created — save the secret field now, it is not shown again' })
  @ApiBody({ type: CreateWebhookDto })
  create(@CurrentUser() user: any, @Body() dto: CreateWebhookDto) {
    return this.webhookService.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List webhook subscriptions for this tenant' })
  @ApiOkResponse({ description: 'Subscriptions list (secret is masked)' })
  list(@CurrentUser() user: any) {
    return this.webhookService.list(user.tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete webhook subscription' })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhookService.remove(user.tenantId, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List last 100 delivery attempts for a subscription' })
  @ApiOkResponse({ description: 'Delivery history — useful for debugging failed deliveries' })
  listDeliveries(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhookService.listDeliveries(user.tenantId, id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Send a test event to verify the subscriber URL is reachable' })
  @ApiCreatedResponse({ description: '{ jobId } — poll delivery history to see result' })
  sendTest(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhookService.sendTestEvent(user.tenantId, id);
  }
}

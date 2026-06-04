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
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiBody,
} from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ProcurementDraftService } from './procurement-draft.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from '../audit/decorators/audit-read.decorator';

class RejectDraftDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('procurement')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('procurement')
export class ProcurementController {
  constructor(private readonly draftService: ProcurementDraftService) {}

  @Get('queue')
  @ApiOperation({
    summary: 'Smart Procurement Queue — pharmacy morning cockpit',
    description:
      'Returns a prioritised view of: pending auto-drafts (urgency ordered), ' +
      'inventory items expiring within 30 days, and in-flight orders awaiting supplier action.',
  })
  @ApiOkResponse({ description: '{ criticalDrafts, expiringStock, pendingOrders }' })
  getQueue(@CurrentUser() user: any) {
    return this.draftService.getProcurementQueue(user.tenantId);
  }

  @Get('drafts')
  @AuditRead('procurement_drafts')
  @ApiOperation({ summary: 'List pending auto-generated procurement drafts' })
  @ApiOkResponse({ description: 'Drafts ordered by urgency then creation date' })
  listDrafts(@CurrentUser() user: any) {
    return this.draftService.findPending(user.tenantId);
  }

  @Post('drafts/:id/approve')
  @ApiOperation({
    summary: 'One-click approve — converts draft to a real order atomically',
    description: 'Verifies supplier availability, creates Order + OrderItem in a single transaction.',
  })
  @ApiCreatedResponse({ description: 'Order created — same response as POST /orders' })
  approveDraft(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.draftService.approveDraft(user.tenantId, id);
  }

  @Delete('drafts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: RejectDraftDto })
  @ApiOperation({ summary: 'Reject a draft — records reason for analytics' })
  @ApiNoContentResponse()
  rejectDraft(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDraftDto,
  ) {
    return this.draftService.rejectDraft(user.tenantId, id, dto.reason);
  }
}

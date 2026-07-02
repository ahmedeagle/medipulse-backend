import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { RecoveryEventService } from './recovery-event.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('recovery')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
@Controller('pharmacy/recovery')
export class RecoveryController {
  constructor(private readonly recovery: RecoveryEventService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Recovery ledger summary — realized vs projected vs lost over a window' })
  @ApiQuery({ name: 'days', required: false, schema: { default: 30 } })
  @ApiOkResponse({ description: '{ since, realizedEgp, pipelineEgp, lostEgp, byType[] }' })
  summary(
    @CurrentUser() user: any,
    @Query('days') days?: string,
  ) {
    const d = Math.min(Math.max(parseInt(days ?? '30', 10) || 30, 1), 365);
    const since = new Date(Date.now() - d * 86_400_000);
    return this.recovery.summary(user.tenantId, since);
  }
}

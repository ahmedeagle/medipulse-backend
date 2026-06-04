import { Controller, Post, Get, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { KeycloakEventsService } from './keycloak-events.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('audit')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/kc-events')
export class AuthEventsController {
  constructor(private readonly svc: KeycloakEventsService) {}

  @Post('poll')
  @ApiOperation({
    summary: 'Manually trigger Keycloak event poll (system admin)',
    description:
      'Normally runs automatically every 5 minutes. ' +
      'Use this to force an immediate sync, e.g. after initial setup.',
  })
  @ApiOkResponse({ description: '{ imported: number }' })
  poll() {
    return this.svc.pollEvents();
  }
}

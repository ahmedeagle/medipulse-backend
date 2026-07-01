import { Controller, Get, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { UsageService } from './usage.service';

@ApiTags('usage')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN, Role.SUPPLIER_ADMIN, Role.SYSTEM_ADMIN)
@Controller('pharmacy/usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @ApiOperation({ summary: 'Current-month usage vs plan caps (AI + WhatsApp) for the credits meter' })
  @ApiOkResponse()
  get(@CurrentUser() user: { tenantId: string | null }) {
    if (!user.tenantId) throw new UnauthorizedException('tenantId claim missing from token');
    return this.usage.summary(user.tenantId);
  }
}

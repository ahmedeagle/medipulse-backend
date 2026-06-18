import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard }   from '../common/guards/jwt-auth.guard';
import { RolesGuard }     from '../common/guards/roles.guard';
import { Roles }          from '../common/decorators/roles.decorator';
import { CurrentUser }    from '../common/decorators/current-user.decorator';
import { Role }           from '../common/enums/role.enum';
import { CreateFeatureRequestDto, UpdateFeatureRequestDto } from './dto/feature-request.dto';
import { FeatureRequestsService } from './feature-requests.service';

@ApiTags('Feature Requests')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeatureRequestsController {
  constructor(private readonly service: FeatureRequestsService) {}

  // ── Pharmacy endpoints ───────────────────────────────────────────────────────

  @Post('pharmacy/feature-requests')
  @HttpCode(201)
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({ summary: 'Submit a feature request from an unanswered chat question' })
  create(
    @CurrentUser() user: { tenantId: string; id?: string },
    @Body() dto: CreateFeatureRequestDto,
  ) {
    return this.service.create(user.tenantId, user.id ?? null, dto);
  }

  @Get('pharmacy/feature-requests')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({ summary: 'List my submitted feature requests' })
  listOwn(@CurrentUser() user: { tenantId: string }) {
    return this.service.listForTenant(user.tenantId);
  }

  // ── Admin endpoints ──────────────────────────────────────────────────────────

  @Get('admin/feature-requests')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'List all feature requests (admin)' })
  listAll(
    @Query('status') status?: string,
    @Query('assignedToUserId') assignedToUserId?: string,
  ) {
    return this.service.listAll({ status, assignedToUserId });
  }

  @Patch('admin/feature-requests/:id')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Update a feature request (admin — assign, change status, add resolution)' })
  update(@Param('id') id: string, @Body() dto: UpdateFeatureRequestDto) {
    return this.service.update(id, dto);
  }
}

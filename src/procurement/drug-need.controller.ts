import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse, ApiCreatedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { DrugNeedService } from './drug-need.service';
import { CreateDrugNeedDto } from './dto/create-drug-need.dto';
import { NeedStatus } from './entities/drug-need-request.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';

/**
 * "أحتاج دواء" — pharmacy demand intake + instant sourcing.
 * Reuses the Decision Engine (ProcurementOrchestrator) under the hood.
 */
@ApiTags('Drug Needs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('needs')
export class DrugNeedController {
  constructor(private readonly needs: DrugNeedService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit a drug need and source it instantly' })
  @ApiCreatedResponse({ description: 'Need recorded with best-source plan (if found)' })
  create(@CurrentUser() user: any, @Body() dto: CreateDrugNeedDto) {
    return this.needs.createNeed(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List this pharmacy\'s drug needs' })
  @ApiOkResponse({ description: 'Drug need requests, newest first' })
  list(@CurrentUser() user: any, @Query('status') status?: NeedStatus) {
    return this.needs.listNeeds(user.tenantId, status);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open drug need' })
  @ApiOkResponse({ description: 'Need cancelled' })
  cancel(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.needs.cancelNeed(user.tenantId, id);
  }
}

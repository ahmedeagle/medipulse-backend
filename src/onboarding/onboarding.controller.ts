import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';

import { OnboardingService } from './onboarding.service';
import {
  SeedConsumptionDto,
  BulkInviteSuppliersDto,
} from './dto/onboarding.dto';

@ApiTags('onboarding')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get('pharmacy/onboarding/checklist')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({
    summary: 'Onboarding progress + recommended next steps for the current pharmacy',
    description:
      'Drives the onboarding banner and the AI cold-start hint. Returns ' +
      'inventory counts, snapshot coverage, open catalog-request count, ' +
      'available supplier count, days since tenant creation, an aiReady ' +
      'flag, and a localized nextSteps[] checklist.',
  })
  @ApiOkResponse({ description: 'OnboardingChecklist' })
  getChecklist(@CurrentUser() user: any) {
    return this.svc.getChecklist(user.tenantId);
  }

  @Post('pharmacy/onboarding/seed-consumption')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Backdate weekly consumption from the legacy ERP to skip the 28-day AI cold start',
    description:
      'Accepts up to 5,000 products, each with up to 52 weekly quantities ' +
      '(index 0 = most recent completed week). Existing snapshots are ' +
      'preserved by default — set preserveExisting=false only when ' +
      'intentionally re-importing.',
  })
  @ApiOkResponse({ description: '{ inserted, skipped, productsSeeded }' })
  seedConsumption(
    @CurrentUser() user: any,
    @Body() dto: SeedConsumptionDto,
  ) {
    return this.svc.seedConsumptionSnapshots(user.tenantId, dto);
  }

  @Post('admin/onboarding/suppliers/bulk-invite')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({
    summary: '[Admin] Create supplier-type tenants in bulk (market bootstrap)',
    description:
      'Up to 200 suppliers per call. Creates the Tenant record only — ' +
      'admin users are still provisioned through the standard invite-user ' +
      'flow afterwards. Slug collisions are returned in failed[].',
  })
  @ApiOkResponse({ description: '{ created: [{ slug, tenantId }], failed: [{ slug, reason }] }' })
  bulkInviteSuppliers(@Body() dto: BulkInviteSuppliersDto) {
    return this.svc.bulkInviteSuppliers(dto);
  }
}

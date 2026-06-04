import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { CatalogRequestsService } from './catalog-requests.service';
import {
  CreateCatalogRequestDto,
  UpdateCatalogRequestDto,
} from './dto/catalog-request.dto';
import { CatalogRequestStatus } from './entities/catalog-request.entity';

@ApiTags('catalog-requests')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CatalogRequestsController {
  constructor(private readonly service: CatalogRequestsService) {}

  // ── Pharmacy endpoints ───────────────────────────────────────────────────

  @Post('catalog/requests')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({
    summary: 'Submit a request to add or fix a product in the central catalog',
    description:
      'Pharmacy-side. Generates a tracking number (REQ-XXXXXX), captures a snapshot ' +
      'of the submitted fields, and starts the request lifecycle.',
  })
  @ApiCreatedResponse({ description: 'Created CatalogRequest with trackingNumber' })
  create(
    @CurrentUser() user: any,
    @Body() dto: CreateCatalogRequestDto,
  ) {
    return this.service.createForPharmacy(user.tenantId, user.id, dto);
  }

  @Get('catalog/requests')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({ summary: 'List my pharmacy\'s catalog requests, newest first' })
  @ApiOkResponse({ description: 'Array of CatalogRequest' })
  listMine(@CurrentUser() user: any) {
    return this.service.listForPharmacy(user.tenantId);
  }

  @Get('catalog/requests/:tracking')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({ summary: 'Get one catalog request by tracking number' })
  @ApiNotFoundResponse({ description: 'Request not found' })
  @ApiForbiddenResponse({ description: 'Request belongs to another pharmacy' })
  getByTracking(
    @CurrentUser() user: any,
    @Param('tracking') tracking: string,
  ) {
    return this.service.getByTrackingForPharmacy(user.tenantId, tracking);
  }

  // ── Admin endpoints ──────────────────────────────────────────────────────

  @Get('admin/catalog/requests')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: '[Admin] List all catalog requests, optionally filtered by status' })
  @ApiOkResponse({ description: 'Array of CatalogRequest' })
  listForAdmin(@Query('status') status?: CatalogRequestStatus) {
    return this.service.listForAdmin({ status });
  }

  @Patch('admin/catalog/requests/:id')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({
    summary: '[Admin] Decide on a catalog request (review / approve / reject / close)',
    description:
      'Approving requires resolvedCatalogProductId so the inventory row can be re-linked. ' +
      'Rejecting requires rejectionReason. Every change is appended to the request timeline.',
  })
  @ApiOkResponse({ description: 'Updated CatalogRequest' })
  updateAsAdmin(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogRequestDto,
  ) {
    return this.service.updateAsAdmin(user.id, id, dto);
  }
}

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { P2pMarketplaceService } from './p2p-marketplace.service';
import { P2pMarketIntelligenceService } from './p2p-market-intelligence.service';
import { P2pSmartProcurementService } from './p2p-smart-procurement.service';
import { PharmacyMatchingService } from './pharmacy-matching.service';
import { SearchMarketplaceDto } from './dto/search-marketplace.dto';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';

@ApiTags('P2P Marketplace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('p2p/marketplace')
export class P2pMarketplaceController {
  constructor(
    private readonly marketplaceService: P2pMarketplaceService,
    private readonly intelligenceService: P2pMarketIntelligenceService,
    private readonly procurementService: P2pSmartProcurementService,
    private readonly matchingService: PharmacyMatchingService,
    private readonly pharmacySettings: PharmacySettingsService,
  ) {}

  @Get('search')
  @ApiOperation({ summary: 'Search marketplace with smart ranking' })
  search(
    @CurrentUser() user: { tenantId: string },
    @Query() dto: SearchMarketplaceDto,
  ) {
    return this.marketplaceService.search(user.tenantId, dto);
  }

  @Get('urgent')
  @ApiOperation({ summary: 'Urgent medicine finder — distance-first, emergency + near-expiry listings' })
  searchUrgent(
    @CurrentUser() user: { tenantId: string },
    @Query('buyerGps') buyerGps?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.marketplaceService.searchUrgent(user.tenantId, buyerGps, limit, offset);
  }

  @Get('listings/:id')
  @ApiOperation({ summary: 'Get a specific marketplace listing with seller info' })
  async getListing(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.marketplaceService.getListing(user.tenantId, id);
    if (!result) throw new NotFoundException('Listing not found or not available');
    return result;
  }

  @Get('intelligence')
  @Roles(Role.PHARMACY_ADMIN)
  getIntelligence(
    @CurrentUser() user: { tenantId: string },
    @Query('city') city?: string,
  ) {
    return this.intelligenceService.getIntelligence(user.tenantId, city);
  }

  @Get('procurement-opportunities')
  @Roles(Role.PHARMACY_ADMIN)
  async getProcurementOpportunities(
    @CurrentUser() user: { tenantId: string },
    @Query('buyerGps') buyerGps?: string,
    @Query('limit') limit?: number,
  ) {
    const settings   = await this.pharmacySettings.getSettings(user.tenantId);
    const aiSettings = settings.aiAnalysisSettings ?? {};
    const threshold  = aiSettings.p2pSavingsThreshold ?? 5;
    const maxDist    = aiSettings.maxP2PDistanceKm    ?? null;

    const opps = await this.procurementService.getOpportunities(
      user.tenantId,
      buyerGps ?? settings.gpsLocation ?? undefined,
      limit ? Number(limit) : 50,
      threshold,
    );

    // Apply distance filter when tenant has set a max distance and GPS is available
    if (maxDist != null) {
      return opps.filter(o => o.distanceKm == null || o.distanceKm <= maxDist);
    }
    return opps;
  }

  @Get('admin/exchange-suggestions')
  @Roles(Role.SYSTEM_ADMIN)
  getExchangeSuggestions(@Query('limit') limit?: number) {
    return this.matchingService.findMatches(limit ? Number(limit) : 50);
  }
}

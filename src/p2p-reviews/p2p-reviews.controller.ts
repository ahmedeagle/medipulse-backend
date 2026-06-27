import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { P2pReviewsService } from './p2p-reviews.service';
import { CreateP2pReviewDto } from './dto/create-p2p-review.dto';

@ApiTags('P2P Reviews')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('p2p')
export class P2pReviewsController {
  constructor(private readonly svc: P2pReviewsService) {}

  // Buyer posts a review for a completed order
  @Post('orders/:id/review')
  @Roles(Role.PHARMACY_ADMIN, Role.SYSTEM_ADMIN)
  @ApiOperation({
    summary: 'Leave a 1–5 rating for a completed P2P order',
    description:
      'Buyer only, after the order is in status "completed". One review per order.',
  })
  create(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateP2pReviewDto,
  ) {
    return this.svc.create(user.tenantId, orderId, dto);
  }

  // Public-ish: any authenticated pharmacy can read a seller's reviews
  @Get('sellers/:tenantId/reviews')
  @Roles(Role.PHARMACY_ADMIN, Role.SYSTEM_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({ summary: 'List reviews for a seller pharmacy (paginated)' })
  list(
    @Param('tenantId', ParseUUIDPipe) sellerTenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.svc.listForSeller(sellerTenantId, { page, pageSize });
  }

  // Aggregate (avg + distribution) — cheap, indexed
  @Get('sellers/:tenantId/reviews/aggregate')
  @Roles(Role.PHARMACY_ADMIN, Role.SYSTEM_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({ summary: 'Aggregate rating + distribution for a seller pharmacy' })
  aggregate(@Param('tenantId', ParseUUIDPipe) sellerTenantId: string) {
    return this.svc.getSellerAggregate(sellerTenantId);
  }
}

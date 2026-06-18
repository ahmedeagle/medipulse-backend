import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { P2pListingService } from './p2p-listing.service';
import { CreateListingDto, UpdateListingDto } from './dto/create-listing.dto';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';

@ApiTags('P2P Listings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('p2p/listings')
export class P2pListingController {
  constructor(private readonly listingService: P2pListingService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a listing without saving (live debounce)' })
  validate(
    @CurrentUser() user: { tenantId: string },
    @Body() dto: CreateListingDto,
  ) {
    return this.listingService.validateOnly(user.tenantId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new listing' })
  create(
    @CurrentUser() user: { tenantId: string },
    @Body() dto: CreateListingDto,
  ) {
    return this.listingService.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List own listings (paginated)' })
  findAll(
    @CurrentUser() user: { tenantId: string },
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.listingService.findOwn(user.tenantId, pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single listing with current issue status' })
  findOne(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listingService.findOneWithIssues(user.tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a listing' })
  update(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingService.update(user.tenantId, id, dto);
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause a listing' })
  pause(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listingService.pause(user.tenantId, id);
  }

  @Patch(':id/resume')
  @ApiOperation({ summary: 'Resume a paused listing' })
  resume(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listingService.resume(user.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a listing (status → expired)' })
  remove(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listingService.softDelete(user.tenantId, id);
  }
}

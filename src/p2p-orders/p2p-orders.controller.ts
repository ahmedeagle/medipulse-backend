import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
  Header,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { P2pOrdersService } from './p2p-orders.service';
import { P2pTransferRecordService } from './p2p-transfer-record.service';
import { CreateP2pOrderDto, AcceptP2pOrderDto, ShipP2pOrderDto, RejectP2pOrderDto, OpenDisputeDto, ListP2pOrdersQueryDto } from './dto/p2p-order.dto';

@ApiTags('P2P Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('p2p/orders')
export class P2pOrdersController {
  constructor(
    private readonly ordersService: P2pOrdersService,
    private readonly transferRecordSvc: P2pTransferRecordService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a purchase request (buyer)' })
  create(
    @CurrentUser() user: { tenantId: string },
    @Body() dto: CreateP2pOrderDto,
  ) {
    return this.ordersService.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List orders (buying + selling)' })
  findAll(
    @CurrentUser() user: { tenantId: string },
    @Query() query: ListP2pOrdersQueryDto,
  ) {
    const { role = 'both', status, q, ...pagination } = query;
    return this.ordersService.findAll(user.tenantId, role, pagination, status, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single order' })
  findOne(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.findOne(user.tenantId, id);
  }

  @Patch(':id/accept')
  @ApiOperation({ summary: 'Accept an order (seller)' })
  accept(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptP2pOrderDto,
  ) {
    return this.ordersService.accept(user.tenantId, id, dto);
  }

  @Patch(':id/ship')
  @ApiOperation({ summary: 'Mark order as shipped (seller)' })
  ship(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShipP2pOrderDto,
  ) {
    return this.ordersService.ship(user.tenantId, id, dto);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject an order (seller)' })
  reject(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectP2pOrderDto,
  ) {
    return this.ordersService.reject(user.tenantId, id, dto);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Confirm receipt (buyer)' })
  complete(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.complete(user.tenantId, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel an order' })
  cancel(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.cancel(user.tenantId, id);
  }

  @Get(':id/invoice')
  @ApiOperation({ summary: 'Get transfer invoice for an accepted order' })
  getInvoice(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getInvoice(user.tenantId, id);
  }

  @Post(':id/dispute')
  @ApiOperation({ summary: 'Open a dispute on a completed order (buyer)' })
  openDispute(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.ordersService.openDispute(user.tenantId, id, dto);
  }

  @Get(':id/dispute')
  @ApiOperation({ summary: 'Get dispute status for an order' })
  getDispute(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getDispute(user.tenantId, id);
  }

  @Get(':id/transfer-record')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Download compliance transfer record (HTML) for completed orders' })
  async getTransferRecord(
    @CurrentUser() user: { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const html = await this.transferRecordSvc.getTransferRecord(user.tenantId, id);
    res.setHeader('Content-Disposition', `inline; filename="transfer-record-${id.slice(0, 8)}.html"`);
    res.send(html);
  }
}

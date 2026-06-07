import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { IsString, IsArray, IsInt, IsOptional, Min, IsUUID, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { OrdersService } from './orders.service';
import { InvoiceService } from './invoice.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStatus } from '../common/enums/order-status.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from '../audit/decorators/audit-read.decorator';

// ── DTOs ──────────────────────────────────────────────────────────────────────

class ReceiveItemDto {
  @IsUUID()             orderItemId:       string;
  @IsInt() @Min(0)      quantityAccepted:  number;
  @IsOptional() @IsInt() @Min(0) quantityRejected?: number;
  @IsOptional() @IsString()  rejectionReason?: string;
  @IsOptional() @IsString()  batchNumber?:     string;
  @IsOptional() @IsString()  expiryDateOnBatch?: string;  // ISO date
}

class ConfirmReceiptDto {
  @IsArray() @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];

  @IsOptional() @IsString()
  deliveryProofUrl?: string;

  @IsOptional() @IsString()
  recipientName?: string;
}

class OrderActionDto {
  @IsOptional() @IsString()
  reason?: string;
}

class CounterOfferDto {
  @IsOptional() @IsString()
  reason?: string;

  @IsOptional() @IsString()
  counterOfferNotes?: string;
}

class AddCommentDto {
  @IsString()
  body: string;
}

class ReturnItemDto {
  @IsUUID()       orderItemId:  string;
  @IsUUID()       productId:    string;
  @IsInt() @Min(1) quantity:   number;
  @IsString()     returnReason: string;
}

class InitiateReturnDto {
  @IsArray() @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly invoiceService: InvoiceService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  @Get()
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({
    summary: 'List orders — filtered by role, with search and pagination',
    description: 'PHARMACY_ADMIN sees their orders. SUPPLIER_ADMIN sees orders directed to them. All support filtering by status, date range, and supplier.',
  })
  @ApiQuery({ name: 'status',           required: false, enum: OrderStatus })
  @ApiQuery({ name: 'supplierTenantId', required: false })
  @ApiQuery({ name: 'from',             required: false, description: 'ISO date' })
  @ApiQuery({ name: 'to',               required: false, description: 'ISO date' })
  @ApiQuery({ name: 'take',             required: false, schema: { default: 25 } })
  @ApiQuery({ name: 'skip',             required: false, schema: { default: 0 } })
  findAll(
    @CurrentUser() user: any,
    @Query('status')           status?: string,
    @Query('supplierTenantId') supplierTenantId?: string,
    @Query('from')             from?: string,
    @Query('to')               to?: string,
    @Query('take', new DefaultValuePipe(25),  ParseIntPipe) take = 25,
    @Query('skip', new DefaultValuePipe(0),   ParseIntPipe) skip = 0,
  ) {
    return this.ordersService.findAll(user, {
      status, supplierTenantId,
      from: from ? new Date(from) : undefined,
      to:   to   ? new Date(to)   : undefined,
      take, skip,
    });
  }

  @Get(':id')
  @AuditRead('order_detail')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Get order detail including full change history' })
  @ApiNotFoundResponse() @ApiForbiddenResponse()
  findOne(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(user, id);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Place a new order',
    description: 'Orders above the tenant approval threshold auto-route to PENDING_APPROVAL. Duplicate orders for the same product+supplier trigger 409 unless allowDuplicate:true is passed.',
  })
  @ApiCreatedResponse()
  create(@CurrentUser() user: any, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user.tenantId, dto, user);
  }

  // ── Status transitions (supplier-owned) ───────────────────────────────────

  @Patch(':id/status')
  @Roles(Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Update order status (supplier side: accept, ship, back-order, etc.)' })
  @ApiBadRequestResponse({ description: 'Invalid status transition' })
  updateStatus(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(user, id, dto.status, { reason: (dto as any).reason });
  }

  // ── Approval (pharmacy director) ──────────────────────────────────────────

  @Post(':id/approve')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Director approval for orders above the approval threshold' })
  @ApiOkResponse()
  approve(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.approve(user, id);
  }

  // ── Receipt confirmation (pharmacy after delivery) ─────────────────────────

  @Post(':id/receive')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Confirm receipt — specify accepted and rejected quantities per item',
    description:
      'Called when order is in RECEIVED_PENDING_QC. ' +
      'If all quantityAccepted = ordered quantity → DELIVERED. ' +
      'If some rejected → PARTIALLY_DELIVERED + auto-creates return request. ' +
      'If all rejected → DISPUTED. ' +
      'Inventory is incremented by quantityAccepted only.',
  })
  @ApiBody({ type: ConfirmReceiptDto })
  @ApiOkResponse()
  confirmReceipt(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmReceiptDto,
  ) {
    return this.ordersService.confirmReceipt(user, id, dto.items, {
      deliveryProofUrl: dto.deliveryProofUrl,
      recipientName:    dto.recipientName,
    });
  }

  // ── Dispute ───────────────────────────────────────────────────────────────

  @Post(':id/dispute')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Open a dispute on a delivered order (quantity mismatch, quality issue, etc.)' })
  @ApiBody({ type: OrderActionDto })
  dispute(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderActionDto,
  ) {
    return this.ordersService.updateStatus(user, id, OrderStatus.DISPUTED, { reason: dto.reason });
  }

  // ── Hold ──────────────────────────────────────────────────────────────────

  @Post(':id/hold')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Put an accepted order on hold (payment dispute, stock issue)' })
  @ApiBody({ type: OrderActionDto })
  hold(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderActionDto,
  ) {
    return this.ordersService.updateStatus(user, id, OrderStatus.ON_HOLD, { reason: dto.reason });
  }

  // ── Return initiation ─────────────────────────────────────────────────────

  @Post(':id/return')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Initiate a return request for delivered items' })
  @ApiBody({ type: InitiateReturnDto })
  @ApiCreatedResponse()
  initiateReturn(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InitiateReturnDto,
  ) {
    return this.ordersService.initiateReturn(user, id, dto.items);
  }

  @Get(':id/returns')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'List return requests for an order' })
  getReturns(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getReturnRequests(id);
  }

  // ── Comment thread ────────────────────────────────────────────────────────

  @Get(':id/comments')
  @AuditRead('order_detail')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Get the full comment thread for an order' })
  getComments(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getComments(user, id);
  }

  // ── Invoice (ZATCA) ───────────────────────────────────────────────────────

  @Get(':id/invoice')
  @AuditRead('invoice')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({
    summary: 'Generate or retrieve the ZATCA-compliant tax invoice for a delivered order',
    description: 'Idempotent — calling twice returns the same invoice. Only available after DELIVERED status.',
  })
  @ApiOkResponse({ description: 'Invoice with ZATCA QR code' })
  getInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceService.generateForOrder(id);
  }

  @Post(':id/comments')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'Add a comment to the order thread (visible to both parties)' })
  @ApiBody({ type: AddCommentDto })
  @ApiCreatedResponse()
  addComment(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.ordersService.addComment(user, id, dto.body);
  }
}

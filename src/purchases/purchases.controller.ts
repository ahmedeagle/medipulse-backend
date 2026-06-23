import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe,
  Patch, Post, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard }    from '../common/guards/jwt-auth.guard';
import { RolesGuard }      from '../common/guards/roles.guard';
import { Roles }           from '../common/decorators/roles.decorator';
import { CurrentUser }     from '../common/decorators/current-user.decorator';
import { Role }            from '../common/enums/role.enum';
import { PurchasesService } from './purchases.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { CreateReturnDto }  from './dto/create-return.dto';
import { InvoiceQueryDto, ReturnQueryDto } from './dto/invoice-query.dto';

@Controller('pharmacy/purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
export class PurchasesController {
  constructor(private readonly svc: PurchasesService) {}

  // ─── Stats & Search ──────────────────────────────────────────────────────────

  @Get('stats')
  getStats(@CurrentUser() user: any) {
    return this.svc.getInvoiceStats(user.pharmacyTenantId);
  }

  @Get('products/search')
  searchProducts(
    @CurrentUser() user: any,
    @Query('q') q: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.svc.searchProducts(user.pharmacyTenantId, q ?? '', supplierId ?? null);
  }

  @Get('products/for-return')
  searchProductsForReturn(
    @CurrentUser() user: any,
    @Query('q') q: string,
    @Query('supplierId') supplierId: string,
  ) {
    return this.svc.getPurchasedProductsForReturn(user.pharmacyTenantId, supplierId ?? null, q ?? '');
  }

  @Get('suppliers')
  getSuppliers(@CurrentUser() user: any) {
    return this.svc.getSuppliers(user.pharmacyTenantId);
  }

  @Get('price-check')
  checkPriceAnomaly(
    @CurrentUser() user: any,
    @Query('productId') productId: string,
    @Query('supplierId') supplierId: string,
    @Query('price') price: string,
  ) {
    return this.svc.checkPriceAnomaly(
      user.pharmacyTenantId,
      productId,
      supplierId ?? null,
      parseFloat(price ?? '0'),
    );
  }

  // ─── Invoices ────────────────────────────────────────────────────────────────

  @Post('invoices')
  createInvoice(@CurrentUser() user: any, @Body() dto: CreateInvoiceDto) {
    return this.svc.createInvoice(user.pharmacyTenantId, dto, user.sub);
  }

  @Get('invoices')
  getInvoices(@CurrentUser() user: any, @Query() query: InvoiceQueryDto) {
    return this.svc.getInvoices(user.pharmacyTenantId, query);
  }

  @Get('invoices/:id')
  getInvoice(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getInvoiceById(user.pharmacyTenantId, id);
  }

  @Patch('invoices/:id')
  updateInvoice(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.svc.updateInvoice(user.pharmacyTenantId, id, dto);
  }

  @Post('invoices/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirmInvoice(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirmInvoice(user.pharmacyTenantId, id, user.sub);
  }

  @Post('invoices/:id/pay')
  @HttpCode(HttpStatus.OK)
  markPaid(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markInvoicePaid(user.pharmacyTenantId, id);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelInvoice(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelInvoice(user.pharmacyTenantId, id, user.sub);
  }

  @Delete('invoices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteInvoice(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteInvoice(user.pharmacyTenantId, id);
  }

  // ─── Returns ─────────────────────────────────────────────────────────────────

  @Post('returns')
  createReturn(@CurrentUser() user: any, @Body() dto: CreateReturnDto) {
    return this.svc.createReturn(user.pharmacyTenantId, dto, user.sub);
  }

  @Get('returns')
  getReturns(@CurrentUser() user: any, @Query() query: ReturnQueryDto) {
    return this.svc.getReturns(user.pharmacyTenantId, query);
  }

  @Get('returns/:id')
  getReturn(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getReturnById(user.pharmacyTenantId, id);
  }

  @Post('returns/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirmReturn(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirmReturn(user.pharmacyTenantId, id);
  }

  @Post('returns/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelReturn(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelReturn(user.pharmacyTenantId, id);
  }

  // ─── Wish list ───────────────────────────────────────────────────────────────

  @Get('wishlist')
  getWishList(@CurrentUser() user: any) {
    return this.svc.getWishList(user.pharmacyTenantId);
  }

  @Post('wishlist')
  addWishListItem(@CurrentUser() user: any, @Body() dto: any) {
    return this.svc.addWishListItem(user.pharmacyTenantId, dto);
  }

  @Patch('wishlist/:id')
  updateWishListItem(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.svc.updateWishListItem(user.pharmacyTenantId, id, dto);
  }

  @Delete('wishlist/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWishListItem(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeWishListItem(user.pharmacyTenantId, id);
  }

  @Post('wishlist/create-orders')
  createOrdersFromWishList(
    @CurrentUser() user: any,
    @Body() dto: { itemIds?: string[] },
  ) {
    return this.svc.createOrdersFromWishList(user.pharmacyTenantId, dto.itemIds ?? [], user.sub);
  }
}

import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  Request, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard }   from '../common/guards/jwt-auth.guard';
import { RolesGuard }     from '../common/guards/roles.guard';
import { Roles }          from '../common/decorators/roles.decorator';
import { Role }           from '../common/enums/role.enum';
import {
  PosService,
  OpenShiftDto, CloseShiftDto,
  CreateTransactionDto, CashMovementDto,
  UpsertCustomerDto, UpsertInsuranceCompanyDto,
} from './pos.service';

function tenantId(req: any): string {
  return req.user?.pharmacyTenantId ?? req.user?.tenantId;
}
function userId(req: any): string {
  return req.user?.sub ?? req.user?.id;
}
function cashierName(req: any): string {
  const u = req.user;
  return [u?.firstName, u?.lastName].filter(Boolean).join(' ') || (u?.email ?? 'Cashier');
}

@Controller('pos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
export class PosController {
  constructor(private readonly pos: PosService) {}

  // ── Shifts ────────────────────────────────────────────────────────────────

  @Post('shifts/open')
  openShift(@Request() req: any, @Body() dto: OpenShiftDto) {
    return this.pos.openShift(tenantId(req), userId(req), cashierName(req), dto);
  }

  @Get('shifts/current')
  getCurrentShift(@Request() req: any) {
    return this.pos.getCurrentShift(tenantId(req));
  }

  @Post('shifts/:id/close')
  closeShift(@Request() req: any, @Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.pos.closeShift(tenantId(req), id, dto);
  }

  @Get('shifts')
  listShifts(
    @Request() req: any,
    @Query('status')    status?: string,
    @Query('cashierId') cashierId?: string,
    @Query('dateFrom')  dateFrom?: string,
    @Query('dateTo')    dateTo?: string,
    @Query('limit')     limit  = 20,
    @Query('offset')    offset = 0,
  ) {
    return this.pos.listShifts(tenantId(req), {
      status: status as 'open' | 'closed' | undefined,
      cashierId,
      dateFrom,
      dateTo,
      limit: +limit,
      offset: +offset,
    });
  }

  @Get('shifts/:id')
  getShift(@Request() req: any, @Param('id') id: string) {
    return this.pos.getShift(tenantId(req), id);
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  @Post('transactions')
  createTransaction(@Request() req: any, @Body() dto: CreateTransactionDto) {
    return this.pos.createTransaction(tenantId(req), userId(req), dto);
  }

  @Get('transactions')
  listTransactions(
    @Request() req: any,
    @Query('shiftId')    shiftId?:    string,
    @Query('customerId') customerId?: string,
    @Query('type')       type?:       string,
    @Query('dateFrom')   dateFrom?:   string,
    @Query('dateTo')     dateTo?:     string,
    @Query('limit')      limit  = 50,
    @Query('offset')     offset = 0,
  ) {
    return this.pos.listTransactions(tenantId(req), { shiftId, customerId, type, dateFrom, dateTo, limit: +limit, offset: +offset });
  }

  @Get('transactions/:id')
  getTransaction(@Request() req: any, @Param('id') id: string) {
    return this.pos.getTransaction(tenantId(req), id);
  }

  @Post('transactions/:id/void')
  @HttpCode(HttpStatus.OK)
  voidTransaction(@Request() req: any, @Param('id') id: string) {
    return this.pos.voidTransaction(tenantId(req), id, userId(req));
  }

  // ── Cash ──────────────────────────────────────────────────────────────────

  @Post('cash-movements')
  recordCashMovement(@Request() req: any, @Body() dto: CashMovementDto) {
    return this.pos.recordCashMovement(tenantId(req), userId(req), dto);
  }

  @Get('cash-movements')
  listCashMovements(@Request() req: any, @Query('shiftId') shiftId: string) {
    return this.pos.listCashMovements(tenantId(req), shiftId);
  }

  // ── Customers ─────────────────────────────────────────────────────────────

  @Post('customers')
  createCustomer(@Request() req: any, @Body() dto: UpsertCustomerDto) {
    return this.pos.createCustomer(tenantId(req), dto);
  }

  @Get('customers')
  listCustomers(
    @Request() req: any,
    @Query('q')      q?:     string,
    @Query('limit')  limit  = 30,
    @Query('offset') offset = 0,
  ) {
    return this.pos.listCustomers(tenantId(req), q, +limit, +offset);
  }

  @Get('customers/:id')
  getCustomer(@Request() req: any, @Param('id') id: string) {
    return this.pos.getCustomer(tenantId(req), id);
  }

  @Patch('customers/:id')
  updateCustomer(@Request() req: any, @Param('id') id: string, @Body() dto: Partial<UpsertCustomerDto>) {
    return this.pos.updateCustomer(tenantId(req), id, dto);
  }

  @Delete('customers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCustomer(@Request() req: any, @Param('id') id: string) {
    return this.pos.deleteCustomer(tenantId(req), id);
  }

  @Get('customers/:id/transactions')
  getCustomerTransactions(
    @Request() req: any,
    @Param('id')     id:    string,
    @Query('limit')  limit  = 20,
    @Query('offset') offset = 0,
  ) {
    return this.pos.getCustomerTransactions(tenantId(req), id, +limit, +offset);
  }

  // ── Product search ────────────────────────────────────────────────────────

  @Get('products/search')
  searchProducts(@Request() req: any, @Query('q') q: string) {
    return this.pos.searchProducts(tenantId(req), q);
  }

  // ── Insurance Companies ───────────────────────────────────────────────────

  @Post('insurance-companies')
  createInsuranceCompany(@Request() req: any, @Body() dto: UpsertInsuranceCompanyDto) {
    return this.pos.createInsuranceCompany(tenantId(req), dto);
  }

  @Get('insurance-companies')
  listInsuranceCompanies(
    @Request() req: any,
    @Query('q')      q?:     string,
    @Query('limit')  limit  = 50,
    @Query('offset') offset = 0,
  ) {
    return this.pos.listInsuranceCompanies(tenantId(req), q, +limit, +offset);
  }

  @Patch('insurance-companies/:id')
  updateInsuranceCompany(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: Partial<UpsertInsuranceCompanyDto>,
  ) {
    return this.pos.updateInsuranceCompany(tenantId(req), id, dto);
  }

  @Delete('insurance-companies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteInsuranceCompany(@Request() req: any, @Param('id') id: string) {
    return this.pos.deleteInsuranceCompany(tenantId(req), id);
  }
}

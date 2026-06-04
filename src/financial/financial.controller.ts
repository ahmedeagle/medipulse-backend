import { Controller, Get, Post, Patch, Param, Body, Query, Request } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { FinancialService } from './financial.service';

@Controller('v1/finance')
export class FinancialController {
  constructor(private readonly svc: FinancialService) {}

  @Get('ledger')
  @Roles(Role.SYSTEM_ADMIN, Role.PHARMACY_ADMIN)
  ledger(
    @Request() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const tenantId = req.user.tenantId;
    return this.svc.getLedger(
      tenantId,
      from ? new Date(from) : new Date(Date.now() - 30 * 86400000),
      to   ? new Date(to)   : new Date(),
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Get('balance')
  @Roles(Role.SYSTEM_ADMIN, Role.PHARMACY_ADMIN)
  balance(@Request() req: any) {
    return this.svc.getBalance(req.user.tenantId);
  }

  @Get('reconciliation/:orderId')
  @Roles(Role.SYSTEM_ADMIN, Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  reconciliation(@Param('orderId') orderId: string) {
    return this.svc.getReconciliation(orderId);
  }

  @Get('credit-wallet')
  @Roles(Role.PHARMACY_ADMIN, Role.SYSTEM_ADMIN)
  getWallet(@Request() req: any) {
    return this.svc.getOrCreateWallet(req.user.tenantId);
  }

  @Patch('credit-wallet/limit')
  @Roles(Role.SYSTEM_ADMIN)
  setLimit(
    @Request() req: any,
    @Body('tenantId') tenantId: string,
    @Body('limitSar') limitSar: number,
  ) {
    return this.svc.setWalletLimit(tenantId, limitSar, req.user.sub);
  }

  @Get('settlements')
  @Roles(Role.SUPPLIER_ADMIN, Role.SYSTEM_ADMIN)
  getSettlements(@Request() req: any) {
    return this.svc.getSettlements(req.user.tenantId);
  }

  @Patch('settlements/:id/approve')
  @Roles(Role.SYSTEM_ADMIN)
  approveSettlement(@Param('id') id: string, @Request() req: any) {
    return this.svc.approveSettlement(id, req.user.sub);
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialLedgerEntry } from './entities/financial-ledger-entry.entity';
import { CreditWallet } from './entities/credit-wallet.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { SupplierSettlement } from './entities/supplier-settlement.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { FinancialService } from './financial.service';
import { FinancialController } from './financial.controller';
import { FinancialHealthCron } from './financial-health.cron';
import { CashFlowProjector } from './cash-flow-projector.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FinancialLedgerEntry,
      CreditWallet,
      PaymentTransaction,
      SupplierSettlement,
      Tenant,
    ]),
    NotificationsModule,
  ],
  controllers: [FinancialController],
  providers:   [FinancialService, FinancialHealthCron, CashFlowProjector],
  exports:     [FinancialService, CashFlowProjector],
})
export class FinancialModule {}

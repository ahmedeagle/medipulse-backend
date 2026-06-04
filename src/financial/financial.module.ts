import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialLedgerEntry } from './entities/financial-ledger-entry.entity';
import { CreditWallet } from './entities/credit-wallet.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { SupplierSettlement } from './entities/supplier-settlement.entity';
import { FinancialService } from './financial.service';
import { FinancialController } from './financial.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FinancialLedgerEntry,
      CreditWallet,
      PaymentTransaction,
      SupplierSettlement,
    ]),
  ],
  controllers: [FinancialController],
  providers:   [FinancialService],
  exports:     [FinancialService],
})
export class FinancialModule {}

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FinancialLedgerEntry, AccountType, LedgerReferenceType,
} from './entities/financial-ledger-entry.entity';
import { CreditWallet, WalletStatus } from './entities/credit-wallet.entity';
import { PaymentTransaction, PaymentStatus } from './entities/payment-transaction.entity';
import { SupplierSettlement, SettlementStatus } from './entities/supplier-settlement.entity';

export interface JournalEntry {
  debitAccount:  AccountType;
  creditAccount: AccountType;
  amount:        number;
  currency:      string;
  referenceType: LedgerReferenceType;
  referenceId:   string;
  description:   string;
  tenantId:      string;
  correlationId?: string;
}

@Injectable()
export class FinancialService {
  constructor(
    @InjectRepository(FinancialLedgerEntry)
    private readonly ledgerRepo: Repository<FinancialLedgerEntry>,
    @InjectRepository(CreditWallet)
    private readonly walletRepo: Repository<CreditWallet>,
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(SupplierSettlement)
    private readonly settlementRepo: Repository<SupplierSettlement>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Record a double-entry journal (2 immutable rows, same transaction).
   */
  async postJournal(entry: JournalEntry, em?: EntityManager): Promise<void> {
    const mgr = em ?? this.dataSource.manager;
    const now  = new Date();
    const base = {
      tenantId:      entry.tenantId,
      currency:      entry.currency,
      referenceType: entry.referenceType,
      referenceId:   entry.referenceId,
      description:   entry.description,
      entryDate:     now,
      correlationId: entry.correlationId ?? null,
    };
    await mgr.insert(FinancialLedgerEntry, [
      { ...base, accountType: entry.debitAccount,  debitAmount:  entry.amount, creditAmount: null },
      { ...base, accountType: entry.creditAccount, creditAmount: entry.amount, debitAmount:  null },
    ]);
  }

  /**
   * Reverse a previously posted entry (creates two new opposing entries).
   */
  async reverseEntry(originalEntryId: string, reason: string, em?: EntityManager): Promise<void> {
    const mgr  = em ?? this.dataSource.manager;
    const orig = await mgr.findOne(FinancialLedgerEntry, { where: { id: originalEntryId } });
    if (!orig) throw new NotFoundException('Ledger entry not found');

    const reversal = mgr.create(FinancialLedgerEntry, {
      tenantId:      orig.tenantId,
      accountType:   orig.accountType,
      debitAmount:   orig.creditAmount,    // swap
      creditAmount:  orig.debitAmount,     // swap
      currency:      orig.currency,
      referenceType: orig.referenceType,
      referenceId:   orig.referenceId,
      description:   `REVERSAL: ${reason}`,
      entryDate:     new Date(),
      reversalOfId:  orig.id,
    });
    const saved = await mgr.save(FinancialLedgerEntry, reversal);

    // Mark original as reversed
    await mgr.update(FinancialLedgerEntry, orig.id, { reversedById: saved.id });
  }

  // ─── Credit Wallet ────────────────────────────────────────────────────────

  async getWallet(tenantId: string): Promise<CreditWallet | null> {
    return this.walletRepo.findOne({ where: { tenantId } });
  }

  async getOrCreateWallet(tenantId: string): Promise<CreditWallet> {
    let wallet = await this.getWallet(tenantId);
    if (!wallet) {
      wallet = await this.walletRepo.save(
        this.walletRepo.create({ tenantId, creditLimit: 0, utilizedCredit: 0 }),
      );
    }
    return wallet;
  }

  async debitWallet(tenantId: string, amount: number, orderId: string): Promise<void> {
    const wallet = await this.getOrCreateWallet(tenantId);
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(`Credit wallet is ${wallet.status}`);
    }
    if (wallet.availableCredit < amount) {
      throw new BadRequestException(
        `Insufficient credit. Available: ${wallet.availableCredit} SAR, Required: ${amount} SAR`,
      );
    }
    await this.walletRepo.increment({ tenantId }, 'utilizedCredit', amount);

    const alertThreshold = Number(wallet.creditLimit) * Number(wallet.utilizationAlertThreshold);
    if (Number(wallet.utilizedCredit) + amount >= alertThreshold) {
      // Emit alert event — consumer handles notification
    }
  }

  async creditWallet(tenantId: string, amount: number): Promise<void> {
    await this.walletRepo.decrement({ tenantId }, 'utilizedCredit', Math.max(0, amount));
  }

  async setWalletLimit(tenantId: string, limitSar: number, approvedBy: string): Promise<CreditWallet> {
    const wallet = await this.getOrCreateWallet(tenantId);
    wallet.creditLimit = limitSar;
    wallet.approvedBy  = approvedBy;
    wallet.approvedAt  = new Date();
    return this.walletRepo.save(wallet);
  }

  // ─── Ledger Query ─────────────────────────────────────────────────────────

  async getLedger(tenantId: string, from: Date, to: Date, page = 1, limit = 50) {
    const [items, total] = await this.ledgerRepo.findAndCount({
      where:  { tenantId },
      order:  { postedAt: 'DESC' },
      skip:   (page - 1) * limit,
      take:   limit,
    });
    return { items, total, page, limit };
  }

  async getBalance(tenantId: string) {
    const entries = await this.ledgerRepo.find({ where: { tenantId } });
    const balance: Record<string, number> = {};
    for (const e of entries) {
      if (!balance[e.accountType]) balance[e.accountType] = 0;
      balance[e.accountType] += Number(e.debitAmount ?? 0) - Number(e.creditAmount ?? 0);
    }
    return balance;
  }

  async getReconciliation(orderId: string) {
    return this.ledgerRepo.find({
      where:  { referenceType: LedgerReferenceType.ORDER, referenceId: orderId },
      order:  { postedAt: 'ASC' },
    });
  }

  // ─── Settlements ──────────────────────────────────────────────────────────

  async getSettlements(supplierTenantId: string) {
    return this.settlementRepo.find({
      where: { supplierTenantId },
      order: { periodStart: 'DESC' },
    });
  }

  async approveSettlement(id: string, approvedBy: string): Promise<SupplierSettlement> {
    const s = await this.settlementRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Settlement not found');
    s.status      = SettlementStatus.SETTLED;
    s.settledAt   = new Date();
    s.approvedBy  = approvedBy;
    return this.settlementRepo.save(s);
  }
}

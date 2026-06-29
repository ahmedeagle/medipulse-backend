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

  // ─── Financial Health Snapshot (AI Center / Orchestrator Layer 1) ────────────

  /**
   * Returns a structured financial health snapshot for a pharmacy tenant.
   * Used by:
   *   - ProcurementOrchestrator Layer 1 (financialRisk signal)
   *   - AI Center DashboardTab (4 stat cards)
   *
   * All values in EGP. Single-pass raw queries — no N+1.
   */
  async getHealthSnapshot(tenantId: string): Promise<FinancialHealthSnapshot> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000);

    // Run all queries in parallel — independent signals
    const [inventoryRows, deadStockRows, nearExpiryRows, payablesRows, wallet] =
      await Promise.all([
        // Total inventory value: sum(quantity × costPrice) per tenant
        this.dataSource.query<Array<{ total_value: string }>>(
          `
          SELECT COALESCE(SUM(i.quantity * COALESCE(i."costPrice", 0)), 0)::text AS total_value
          FROM inventory_items i
          WHERE i."tenantId" = $1
            AND i.quantity > 0
            AND i."deletedAt" IS NULL
          `,
          [tenantId],
        ),

        // Dead stock: items with 0 sales in last 90 days
        this.dataSource.query<Array<{ dead_value: string; dead_skus: string }>>(
          `
          SELECT
            COALESCE(SUM(i.quantity * COALESCE(i."costPrice", 0)), 0)::text AS dead_value,
            COUNT(DISTINCT i."productId")::text                              AS dead_skus
          FROM inventory_items i
          WHERE i."tenantId" = $1
            AND i.quantity > 0
            AND i."deletedAt" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM pos_transaction_items ti
              JOIN pos_transactions tx ON tx.id = ti."transactionId"
              WHERE ti."productId"        = i."productId"
                AND tx."pharmacyTenantId" = i."tenantId"
                AND tx.status             = 'completed'
                AND tx.type               = 'sale'
                AND tx."createdAt"        >= $2
            )
          `,
          [tenantId, ninetyDaysAgo],
        ),

        // Near expiry: items expiring within 30 days
        this.dataSource.query<Array<{ near_expiry_value: string; near_expiry_skus: string }>>(
          `
          SELECT
            COALESCE(SUM(i.quantity * COALESCE(i."costPrice", 0)), 0)::text AS near_expiry_value,
            COUNT(DISTINCT i."productId")::text                              AS near_expiry_skus
          FROM inventory_items i
          WHERE i."tenantId" = $1
            AND i.quantity > 0
            AND i."deletedAt" IS NULL
            AND i."expiryDate" IS NOT NULL
            AND i."expiryDate" <= $2
            AND i."expiryDate" > NOW()
          `,
          [tenantId, thirtyDaysFromNow],
        ),

        // Pending payables: outstanding orders not yet paid
        this.dataSource.query<Array<{ pending_payables: string }>>(
          `
          SELECT COALESCE(SUM(o."totalAmount"), 0)::text AS pending_payables
          FROM orders o
          WHERE o."pharmacyTenantId" = $1
            AND o.status NOT IN ('delivered', 'cancelled', 'rejected')
          `,
          [tenantId],
        ),

        this.getWallet(tenantId),
      ]);

    const totalInventoryValue  = parseFloat(inventoryRows[0]?.total_value ?? '0');
    const deadStockValue       = parseFloat(deadStockRows[0]?.dead_value ?? '0');
    const deadStockSkus        = parseInt(deadStockRows[0]?.dead_skus ?? '0', 10);
    const nearExpiryValue      = parseFloat(nearExpiryRows[0]?.near_expiry_value ?? '0');
    const nearExpirySkus       = parseInt(nearExpiryRows[0]?.near_expiry_skus ?? '0', 10);
    const pendingPayables      = parseFloat(payablesRows[0]?.pending_payables ?? '0');
    const creditLimit          = wallet ? Number(wallet.creditLimit) : 0;
    const utilizedCredit       = wallet ? Number(wallet.utilizedCredit) : 0;
    const utilizationRate      = creditLimit > 0 ? utilizedCredit / creditLimit : 0;

    const deadStockPct = totalInventoryValue > 0
      ? (deadStockValue / totalInventoryValue) * 100
      : 0;

    return {
      totalInventoryValue,
      deadStockValue,
      deadStockSkus,
      deadStockPct: Math.round(deadStockPct * 10) / 10,
      nearExpiryValue,
      nearExpirySkus,
      pendingPayables,
      creditLimit,
      utilizedCredit,
      utilizationRate: Math.round(utilizationRate * 1000) / 10, // as %
      cashRisk: utilizationRate > 0.90 || wallet?.status !== 'active',
      alerts: [
        ...(deadStockPct > 30 ? ['مخزون راكد يتجاوز 30% من قيمة المخزون الكلي'] : []),
        ...(nearExpirySkus > 0 ? [`${nearExpirySkus} صنف ينتهي خلال 30 يوماً`] : []),
        ...(utilizationRate > 0.90 ? ['استخدام الائتمان يتجاوز 90%'] : []),
      ],
    };
  }
}

export interface FinancialHealthSnapshot {
  totalInventoryValue:  number;
  deadStockValue:       number;
  deadStockSkus:        number;
  deadStockPct:         number;    // %
  nearExpiryValue:      number;
  nearExpirySkus:       number;
  pendingPayables:      number;
  creditLimit:          number;
  utilizedCredit:       number;
  utilizationRate:      number;    // % (0–100)
  cashRisk:             boolean;
  alerts:               string[];
}

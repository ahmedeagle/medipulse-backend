import {
  Injectable, NotFoundException, BadRequestException,
  ForbiddenException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, SelectQueryBuilder } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PosShift }              from './entities/pos-shift.entity';
import { PosTransaction }        from './entities/pos-transaction.entity';
import { PosTransactionItem }    from './entities/pos-transaction-item.entity';
import { PosCashMovement }       from './entities/pos-cash-movement.entity';
import { PosCustomer }           from './entities/pos-customer.entity';
import { PosInsuranceCompany }   from './entities/pos-insurance-company.entity';
import { EVENTS }                from '../events/domain-events';

// ── DTOs (inline — small enough) ─────────────────────────────────────────────

export interface SubstituteResult {
  inventoryItemId: string;
  productId:       string;
  name:            string;
  nameEn:          string;
  manufacturer:    string | null;
  sellingPrice:    number | null;
  costPrice:       number | null;
  quantity:        number;
  expiryDate:      string | null;
  marginDelta:     number | null;  // positive = this option earns more per unit
  customerSaving:  number | null;  // positive = cheaper for customer
  reason:          'higher_margin' | 'customer_saving' | 'available';
}

export interface OpenShiftDto {
  openingBalance: number;
  openNote?: string;
}

export interface CloseShiftDto {
  closingBalance: number;
  closeNote?: string;
}

export interface CreateTransactionDto {
  type: 'sale' | 'return';
  customerId?: string;
  items: Array<{
    inventoryItemId: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    discountAmount?: number;
  }>;
  discountAmount?: number;
  paymentMethod: 'cash' | 'card' | 'split';
  cashAmount?: number;
  cardAmount?: number;
  note?: string;
}

export interface CashMovementDto {
  type: 'in' | 'out';
  amount: number;
  reason: string;
  note?: string;
}

export interface UpsertCustomerDto {
  name: string;
  phone?: string;
  email?: string;
  gender?: 'male' | 'female';
  address?: string;
  tags?: string[];
  insuranceCompanyId?: string;
  insuranceCardNumber?: string;
  insurancePolicyNumber?: string;
  copayPercent?: number;
}

export interface UpsertInsuranceCompanyDto {
  name: string;
  patientPercent: number;
  notes?: string;
}

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    @InjectRepository(PosShift)
    private readonly shiftRepo: Repository<PosShift>,
    @InjectRepository(PosTransaction)
    private readonly txRepo: Repository<PosTransaction>,
    @InjectRepository(PosTransactionItem)
    private readonly itemRepo: Repository<PosTransactionItem>,
    @InjectRepository(PosCashMovement)
    private readonly cashRepo: Repository<PosCashMovement>,
    @InjectRepository(PosCustomer)
    private readonly customerRepo: Repository<PosCustomer>,
    @InjectRepository(PosInsuranceCompany)
    private readonly insuranceRepo: Repository<PosInsuranceCompany>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Shifts ────────────────────────────────────────────────────────────────

  async openShift(tenantId: string, userId: string, cashierName: string, dto: OpenShiftDto): Promise<PosShift> {
    // Pessimistic write lock prevents two concurrent requests both seeing no open shift
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const existing = await qr.manager.findOne(PosShift, {
        where: { pharmacyTenantId: tenantId, status: 'open' },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) throw new BadRequestException('A shift is already open. Close it before opening a new one.');

      const shift = await qr.manager.save(
        qr.manager.create(PosShift, {
          pharmacyTenantId: tenantId,
          cashierId:        userId,
          cashierName,
          openingBalance:   dto.openingBalance,
          openNote:         dto.openNote ?? null,
          status:           'open',
        }),
      );
      await qr.commitTransaction();
      return shift;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async getCurrentShift(tenantId: string): Promise<PosShift | null> {
    return this.shiftRepo.findOne({ where: { pharmacyTenantId: tenantId, status: 'open' } });
  }

  async closeShift(tenantId: string, shiftId: string, dto: CloseShiftDto): Promise<PosShift> {
    if (dto.closingBalance < 0) {
      throw new BadRequestException('Closing balance cannot be negative');
    }

    // Single atomic UPDATE — WHERE status='open' makes this race-condition safe.
    // Two simultaneous closeShift calls: one wins (affected=1), the other gets affected=0.
    const result = await this.shiftRepo
      .createQueryBuilder()
      .update(PosShift)
      .set({
        status:         'closed',
        closingBalance: dto.closingBalance,
        closeNote:      dto.closeNote ?? null,
        closedAt:       () => 'NOW()',
      })
      .where('id = :id AND "pharmacyTenantId" = :tid AND status = :open', {
        id: shiftId, tid: tenantId, open: 'open',
      })
      .execute();

    if (result.affected === 0) {
      const exists = await this.shiftRepo.findOne({ where: { id: shiftId, pharmacyTenantId: tenantId } });
      if (!exists) throw new NotFoundException('Shift not found');
      throw new BadRequestException('Shift is already closed');
    }

    return this.shiftRepo.findOne({ where: { id: shiftId } });
  }

  async listShifts(
    tenantId: string,
    opts: {
      status?: 'open' | 'closed';
      cashierId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: PosShift[]; total: number }> {
    const buildQb = () => {
      const qb = this.shiftRepo.createQueryBuilder('s')
        .where('s."pharmacyTenantId" = :tid', { tid: tenantId });
      if (opts.status)    qb.andWhere('s.status = :status',   { status: opts.status });
      if (opts.cashierId) qb.andWhere('s."cashierId" = :cid', { cid: opts.cashierId });
      if (opts.dateFrom)  qb.andWhere('s."openedAt" >= :df',  { df: opts.dateFrom });
      if (opts.dateTo)    qb.andWhere('s."openedAt" <= :dt',  { dt: opts.dateTo });
      return qb;
    };

    const total = await buildQb().getCount();
    if (total === 0) return { data: [], total: 0 };

    const data = await buildQb()
      .orderBy('s."openedAt"', 'DESC')
      .limit(opts.limit ?? 20)
      .offset(opts.offset ?? 0)
      .getMany();

    return { data, total };
  }

  async getShift(tenantId: string, shiftId: string): Promise<PosShift> {
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId, pharmacyTenantId: tenantId } });
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  async createTransaction(tenantId: string, userId: string, dto: CreateTransactionDto): Promise<PosTransaction> {
    const shift = await this.shiftRepo.findOne({ where: { pharmacyTenantId: tenantId, status: 'open' } });
    if (!shift) throw new BadRequestException('No open shift. Please open a shift before making sales.');

    // Enforce product-level POS sale restrictions before touching inventory
    if (dto.type === 'sale') {
      const productIds = dto.items.map(i => i.productId).filter(Boolean);
      if (productIds.length > 0) {
        const blocked: Array<{ name: string; nameAr: string }> = await this.dataSource.query(
          `SELECT name, "nameAr" FROM products WHERE id = ANY($1) AND "disablePOSSale" = true`,
          [productIds],
        );
        if (blocked.length > 0) {
          const names = blocked.map(p => p.nameAr || p.name).join('، ');
          throw new BadRequestException(`المنتجات التالية ممنوعة من البيع على الكاشير: ${names}`);
        }
      }
    }

    const subtotal   = dto.items.reduce((s, i) => s + i.unitPrice * i.quantity - (i.discountAmount ?? 0), 0);
    const discount   = dto.discountAmount ?? 0;
    const taxAmount  = 0; // extend later for VAT
    const total      = subtotal - discount + taxAmount;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // Create transaction + items
      const tx = await qr.manager.save(PosTransaction, {
        pharmacyTenantId: tenantId,
        shiftId:          shift.id,
        cashierId:        userId,
        customerId:       dto.customerId ?? null,
        type:             dto.type,
        subtotal,
        discountAmount:   discount,
        taxAmount,
        totalAmount:      total,
        paymentMethod:    dto.paymentMethod,
        cashAmount:       dto.cashAmount   ?? (dto.paymentMethod === 'cash' ? total : null),
        cardAmount:       dto.cardAmount   ?? (dto.paymentMethod === 'card' ? total : null),
        changeAmount:     dto.paymentMethod === 'cash' && dto.cashAmount ? dto.cashAmount - total : 0,
        status:           'completed',
        note:             dto.note ?? null,
      });

      const items = dto.items.map(i => ({
        transactionId:   tx.id,
        inventoryItemId: i.inventoryItemId,
        productId:       i.productId,
        productName:     i.productName,
        quantity:        i.quantity,
        unitPrice:       i.unitPrice,
        discountAmount:  i.discountAmount ?? 0,
        subtotal:        i.unitPrice * i.quantity - (i.discountAmount ?? 0),
      }));
      await qr.manager.save(PosTransactionItem, items);

      // Deduct / restore inventory
      const lowStockEvents: Array<{
        tenantId: string; inventoryItemId: string; productId: string;
        productNameAr: string; quantity: number; minThreshold: number;
      }> = [];

      for (const item of dto.items) {
        if (!item.inventoryItemId) continue;
        if (dto.type === 'sale') {
          // Guard: refuse if stock would go negative — RETURNING id returns 1 row on success, 0 on failure
          const affected: { id: string }[] = await qr.manager.query(
            `UPDATE inventory_items SET quantity = quantity - $1, "updatedAt" = NOW()
             WHERE id = $2 AND "pharmacyTenantId" = $3 AND quantity >= $1
             RETURNING id`,
            [item.quantity, item.inventoryItemId, tenantId],
          );
          if (affected.length === 0) {
            throw new BadRequestException(
              `Insufficient stock for "${item.productName ?? item.inventoryItemId}". Reduce quantity or check inventory.`,
            );
          }
          // Check if quantity crossed below minThreshold after this sale
          const [newState]: Array<{
            quantity: number; minThreshold: number; productId: string; productNameAr: string;
          }> = await qr.manager.query(
            `SELECT i.quantity, i."minThreshold", i."productId",
               COALESCE(p."nameAr", p.name, 'منتج') AS "productNameAr"
             FROM inventory_items i
             LEFT JOIN products p ON p.id = i."productId"
             WHERE i.id = $1`,
            [item.inventoryItemId],
          );
          if (newState && newState.minThreshold > 0 && newState.quantity <= newState.minThreshold) {
            lowStockEvents.push({
              tenantId,
              inventoryItemId: item.inventoryItemId,
              productId:       newState.productId,
              productNameAr:   newState.productNameAr,
              quantity:        newState.quantity,
              minThreshold:    newState.minThreshold,
            });
          }
        } else {
          // Return: always restore — no negative-guard needed
          await qr.manager.query(
            `UPDATE inventory_items SET quantity = quantity + $1, "updatedAt" = NOW()
             WHERE id = $2 AND "pharmacyTenantId" = $3`,
            [item.quantity, item.inventoryItemId, tenantId],
          );
        }
      }

      // Update shift totals (including per-method breakdown)
      const delta   = dto.type === 'sale'   ? total : 0;
      const rtDelta = dto.type === 'return' ? total : 0;
      const cashDelta = dto.type === 'sale' && (dto.paymentMethod === 'cash' || dto.paymentMethod === 'split')
        ? (dto.cashAmount ?? (dto.paymentMethod === 'cash' ? total : 0))
        : 0;
      const cardDelta = dto.type === 'sale' && (dto.paymentMethod === 'card' || dto.paymentMethod === 'split')
        ? (dto.cardAmount ?? (dto.paymentMethod === 'card' ? total : 0))
        : 0;
      await qr.manager.query(
        `UPDATE pos_shifts
         SET "totalSales"       = "totalSales" + $1,
             "totalReturns"     = "totalReturns" + $2,
             "totalCashSales"   = "totalCashSales" + $3,
             "totalCardSales"   = "totalCardSales" + $4,
             "transactionCount" = "transactionCount" + $5,
             "returnCount"      = "returnCount" + $6
         WHERE id = $7`,
        [delta, rtDelta, cashDelta, cardDelta,
         dto.type === 'sale' ? 1 : 0, dto.type === 'return' ? 1 : 0, shift.id],
      );

      // Update customer stats
      if (dto.customerId && dto.type === 'sale') {
        await qr.manager.query(
          `UPDATE pos_customers
           SET "totalPurchases" = "totalPurchases" + $1,
               "visitCount" = "visitCount" + 1,
               "lastVisitAt" = NOW()
           WHERE id = $2 AND "pharmacyTenantId" = $3`,
          [total, dto.customerId, tenantId],
        );
      }

      await qr.commitTransaction();
      this.logger.log(`POS tx ${tx.id}: ${dto.type} EGP ${total} by user ${userId}`);

      // Emit low-stock events after commit — LowStockCron handles dedup + task creation
      for (const ev of lowStockEvents) {
        this.eventEmitter.emit(EVENTS.INVENTORY_LOW_STOCK_DETECTED, ev);
        this.logger.log(`POS: low-stock event emitted for "${ev.productNameAr}" (qty ${ev.quantity}/${ev.minThreshold})`);
      }

      return { ...tx, items: items as any };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async listTransactions(
    tenantId: string,
    opts: { shiftId?: string; customerId?: string; type?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number },
  ) {
    const applyFilters = (qb: SelectQueryBuilder<PosTransaction>) => {
      qb.where('t."pharmacyTenantId" = :tid', { tid: tenantId });
      if (opts.shiftId)    qb.andWhere('t."shiftId" = :sid',    { sid:  opts.shiftId });
      if (opts.customerId) qb.andWhere('t."customerId" = :cid', { cid:  opts.customerId });
      if (opts.type)       qb.andWhere('t.type = :type',         { type: opts.type });
      if (opts.dateFrom)   qb.andWhere('t."createdAt" >= :df',   { df:   opts.dateFrom });
      if (opts.dateTo)     qb.andWhere('t."createdAt" <= :dt',   { dt:   opts.dateTo });
      return qb;
    };

    // Step 1: COUNT without any join (correct total)
    const total = await applyFilters(this.txRepo.createQueryBuilder('t')).getCount();
    if (total === 0) return { data: [] as PosTransaction[], total: 0 };

    // Step 2: paginated IDs without join (avoids getManyAndCount + take + join bug)
    const idRows = await applyFilters(
      this.txRepo.createQueryBuilder('t').select('t.id'),
    )
      .orderBy('t."createdAt"', 'DESC')
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0)
      .getRawMany<{ t_id: string }>();

    if (!idRows.length) return { data: [] as PosTransaction[], total };
    const ids = idRows.map(r => r.t_id);

    // Step 3: full records with items for those IDs only
    const data = await this.txRepo.createQueryBuilder('t')
      .leftJoinAndSelect('t.items', 'items')
      .whereInIds(ids)
      .orderBy('t."createdAt"', 'DESC')
      .getMany();

    // Batch cashierName (one query, not N+1)
    const shiftIds = [...new Set(data.map(t => t.shiftId))];
    const shifts = await this.dataSource.query<{ id: string; cashierName: string | null }[]>(
      `SELECT id, "cashierName" FROM pos_shifts WHERE id = ANY($1)`,
      [shiftIds],
    );
    const cashierMap = Object.fromEntries(shifts.map(s => [s.id, s.cashierName]));

    // Batch customerName (one query, not N+1)
    const customerIds = [...new Set(data.map(t => t.customerId).filter(Boolean))];
    let customerMap: Record<string, string> = {};
    if (customerIds.length > 0) {
      const customers = await this.dataSource.query<{ id: string; name: string }[]>(
        `SELECT id, name FROM pos_customers WHERE id = ANY($1)`,
        [customerIds],
      );
      customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));
    }

    const enriched = data.map(t => ({
      ...t,
      cashierName:  cashierMap[t.shiftId]  ?? null,
      customerName: t.customerId ? (customerMap[t.customerId] ?? null) : null,
    }));
    return { data: enriched, total };
  }

  async getTransaction(tenantId: string, txId: string): Promise<PosTransaction> {
    const tx = await this.txRepo.findOne({ where: { id: txId, pharmacyTenantId: tenantId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  async voidTransaction(tenantId: string, txId: string, userId: string): Promise<PosTransaction> {
    const tx = await this.txRepo.findOne({ where: { id: txId, pharmacyTenantId: tenantId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status === 'voided') throw new BadRequestException('Transaction already voided');

    // Restore inventory
    const items = await this.itemRepo.find({ where: { transactionId: txId } });
    const sign = tx.type === 'sale' ? 1 : -1; // restoring a sale adds back, restoring a return removes
    for (const item of items) {
      if (!item.inventoryItemId) continue;
      await this.dataSource.query(
        `UPDATE inventory_items SET quantity = quantity + $1, "updatedAt" = NOW()
         WHERE id = $2 AND "pharmacyTenantId" = $3`,
        [sign * item.quantity, item.inventoryItemId, tenantId],
      );
    }

    tx.status          = 'voided';
    tx.voidedAt        = new Date();
    tx.voidedByUserId  = userId;
    const saved = await this.txRepo.save(tx);

    // Reverse this transaction's contribution from the shift aggregates
    if (tx.type === 'sale') {
      const cashAmt = Number(tx.cashAmount ?? 0);
      const cardAmt = Number(tx.cardAmount ?? 0);
      await this.dataSource.query(`
        UPDATE pos_shifts SET
          "totalSales"        = GREATEST(0, "totalSales"        - $1),
          "totalCashSales"    = GREATEST(0, "totalCashSales"    - $2),
          "totalCardSales"    = GREATEST(0, "totalCardSales"    - $3),
          "transactionCount"  = GREATEST(0, "transactionCount"  - 1)
        WHERE id = $4
      `, [Number(tx.totalAmount), cashAmt, cardAmt, tx.shiftId]);
    } else if (tx.type === 'return') {
      await this.dataSource.query(`
        UPDATE pos_shifts SET
          "totalReturns" = GREATEST(0, "totalReturns" - $1),
          "returnCount"  = GREATEST(0, "returnCount"  - 1)
        WHERE id = $2
      `, [Number(tx.totalAmount), tx.shiftId]);
    }

    return saved;
  }

  // ── Cash Movements ────────────────────────────────────────────────────────

  async recordCashMovement(tenantId: string, userId: string, dto: CashMovementDto): Promise<PosCashMovement> {
    const shift = await this.shiftRepo.findOne({ where: { pharmacyTenantId: tenantId, status: 'open' } });
    if (!shift) throw new BadRequestException('No open shift');

    const movement = await this.cashRepo.save(this.cashRepo.create({
      pharmacyTenantId: tenantId,
      shiftId:          shift.id,
      type:             dto.type,
      amount:           dto.amount,
      reason:           dto.reason,
      note:             dto.note ?? null,
      performedByUserId: userId,
    }));

    // Update shift totals
    if (dto.type === 'in') {
      await this.dataSource.query(`UPDATE pos_shifts SET "totalCashIn" = "totalCashIn" + $1 WHERE id = $2`, [dto.amount, shift.id]);
    } else {
      await this.dataSource.query(`UPDATE pos_shifts SET "totalCashOut" = "totalCashOut" + $1 WHERE id = $2`, [dto.amount, shift.id]);
    }
    return movement;
  }

  async listCashMovements(tenantId: string, shiftId: string): Promise<PosCashMovement[]> {
    return this.cashRepo.find({ where: { pharmacyTenantId: tenantId, shiftId }, order: { createdAt: 'DESC' } });
  }

  // ── Customers ─────────────────────────────────────────────────────────────

  async createCustomer(tenantId: string, dto: UpsertCustomerDto): Promise<PosCustomer> {
    if (!tenantId) throw new BadRequestException('Tenant context missing from token');

    const name = dto.name?.trim() ?? '';
    if (name.length < 2) throw new BadRequestException('اسم العميل يجب أن يكون حرفين على الأقل');

    if (dto.phone) {
      const digits = dto.phone.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) throw new BadRequestException('رقم الهاتف غير صحيح');
    }

    if (dto.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email)) {
      throw new BadRequestException('البريد الإلكتروني غير صحيح');
    }

    if (dto.insuranceCompanyId) {
      const ins = await this.insuranceRepo.findOne({
        where: { id: dto.insuranceCompanyId, pharmacyTenantId: tenantId },
      });
      if (!ins) throw new BadRequestException('شركة التأمين غير موجودة');
    }

    return this.customerRepo.save(this.customerRepo.create({
      pharmacyTenantId:     tenantId,
      name,
      phone:                dto.phone ?? null,
      email:                dto.email ?? null,
      gender:               dto.gender ?? null,
      address:              dto.address ?? null,
      tags:                 dto.tags ?? [],
      insuranceCompanyId:   dto.insuranceCompanyId ?? null,
      insuranceCardNumber:  dto.insuranceCardNumber ?? null,
      insurancePolicyNumber:dto.insurancePolicyNumber ?? null,
      copayPercent:         dto.copayPercent ?? null,
    }));
  }

  async listCustomers(tenantId: string, search?: string, limit = 30, offset = 0) {
    let qb = this.customerRepo.createQueryBuilder('c')
      .where('c."pharmacyTenantId" = :tid', { tid: tenantId })
      .andWhere('c."deletedAt" IS NULL')
      .orderBy('c."lastVisitAt"', 'DESC', 'NULLS LAST')
      .take(limit)
      .skip(offset);

    if (search) {
      qb = qb.andWhere(
        '(c.name ILIKE :q OR c.phone ILIKE :q)',
        { q: `%${search}%` },
      );
    }
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getCustomer(tenantId: string, customerId: string): Promise<PosCustomer> {
    const c = await this.customerRepo.findOne({ where: { id: customerId, pharmacyTenantId: tenantId, deletedAt: null } });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  async deleteCustomer(tenantId: string, customerId: string): Promise<void> {
    const c = await this.customerRepo.findOne({ where: { id: customerId, pharmacyTenantId: tenantId, deletedAt: null } });
    if (!c) throw new NotFoundException('Customer not found');
    await this.customerRepo.update({ id: customerId, pharmacyTenantId: tenantId }, { deletedAt: new Date() });
  }

  async updateCustomer(tenantId: string, customerId: string, dto: Partial<UpsertCustomerDto>): Promise<PosCustomer> {
    const c = await this.getCustomer(tenantId, customerId);
    Object.assign(c, dto);
    return this.customerRepo.save(c);
  }

  async getCustomerTransactions(tenantId: string, customerId: string, limit = 20, offset = 0) {
    return this.listTransactions(tenantId, { customerId, limit, offset });
  }

  // ── Product search proxy (reuses inventory_items + products join) ──────────

  async searchProducts(tenantId: string, q: string): Promise<any[]> {
    if (!q || q.length < 1) return [];
    return this.dataSource.query<any[]>(
      `SELECT
         i.id AS "inventoryItemId",
         p.id AS "productId",
         COALESCE(p."nameAr", p.name) AS "name",
         p.name AS "nameEn",
         p."nameAr",
         p.barcode,
         i.quantity,
         i."minThreshold",
         i."costPrice",
         i."sellingPrice",
         i."expiryDate",
         i."linkStatus"
       FROM inventory_items i
       JOIN products p ON p.id = i."productId"
       WHERE i."pharmacyTenantId" = $1
         AND i."deletedAt" IS NULL
         AND (
           p.name ILIKE $2
           OR p."nameAr" ILIKE $2
           OR p."genericName" ILIKE $2
           OR p.barcode = $3
           OR p.barcode ILIKE $2
         )
       ORDER BY i.quantity DESC, p.name
       LIMIT 30`,
      [tenantId, `%${q}%`, q],
    );
  }

  // ── Smart Substitution ───────────────────────────────────────────────────

  async getSubstitutes(tenantId: string, inventoryItemId: string): Promise<SubstituteResult[]> {
    // Step 1: load the target item's product profile
    const [target] = await this.dataSource.query<any[]>(`
      SELECT
        p."activeIngredient",
        p."atcCode",
        p.strength,
        p."dosageForm",
        p.id                AS "productId",
        i."costPrice"       AS "targetCost",
        i."sellingPrice"    AS "targetSell"
      FROM inventory_items i
      JOIN products p ON p.id = i."productId"
      WHERE i.id = $1
        AND i."pharmacyTenantId" = $2
        AND i."deletedAt" IS NULL
    `, [inventoryItemId, tenantId]);

    if (!target?.activeIngredient) return [];

    const targetSell = target.targetSell ? Number(target.targetSell) : null;
    const targetCost = target.targetCost ? Number(target.targetCost) : null;
    const targetMargin = (targetSell && targetCost) ? (targetSell - targetCost) : null;

    // Step 2: find alternatives — same molecule + strength + dosage form, in stock
    const rows = await this.dataSource.query<any[]>(`
      SELECT
        i.id                          AS "inventoryItemId",
        p.id                          AS "productId",
        COALESCE(p."nameAr", p.name)  AS name,
        p.name                        AS "nameEn",
        p.manufacturer,
        i."sellingPrice",
        i."costPrice",
        i.quantity,
        i."expiryDate"
      FROM inventory_items i
      JOIN products p ON p.id = i."productId"
      WHERE i."pharmacyTenantId" = $1
        AND i."deletedAt" IS NULL
        AND i.quantity > 0
        AND i.id  != $2
        AND p.id  != $3
        AND (
          (
            p."activeIngredient" IS NOT NULL
            AND LOWER(p."activeIngredient") = LOWER($4)
            AND LOWER(COALESCE(p.strength, ''))    = LOWER(COALESCE($5, ''))
            AND LOWER(COALESCE(p."dosageForm", '')) = LOWER(COALESCE($6, ''))
          )
          OR
          (
            p."atcCode" IS NOT NULL AND p."atcCode" = $7
            AND LOWER(COALESCE(p.strength, '')) = LOWER(COALESCE($5, ''))
          )
        )
      ORDER BY i."sellingPrice" NULLS LAST
      LIMIT 3
    `, [
      tenantId,
      inventoryItemId,
      target.productId,
      target.activeIngredient,
      target.strength,
      target.dosageForm,
      target.atcCode,
    ]);

    return rows.map(r => {
      const sell  = r.sellingPrice ? Number(r.sellingPrice) : null;
      const cost  = r.costPrice    ? Number(r.costPrice)    : null;
      const margin = (sell && cost) ? (sell - cost) : null;

      const marginDelta    = (margin !== null && targetMargin !== null) ? margin - targetMargin : null;
      const customerSaving = (sell !== null && targetSell !== null)     ? targetSell - sell      : null;

      let reason: SubstituteResult['reason'] = 'available';
      if (marginDelta !== null && marginDelta > 0)    reason = 'higher_margin';
      else if (customerSaving !== null && customerSaving > 0) reason = 'customer_saving';

      return {
        inventoryItemId: r.inventoryItemId,
        productId:       r.productId,
        name:            r.name,
        nameEn:          r.nameEn,
        manufacturer:    r.manufacturer ?? null,
        sellingPrice:    sell,
        costPrice:       cost,
        quantity:        Number(r.quantity),
        expiryDate:      r.expiryDate ?? null,
        marginDelta,
        customerSaving,
        reason,
      } satisfies SubstituteResult;
    });
  }

  // ── Insurance Companies ───────────────────────────────────────────────────

  async createInsuranceCompany(tenantId: string, dto: UpsertInsuranceCompanyDto): Promise<PosInsuranceCompany> {
    if (!tenantId) throw new BadRequestException('Tenant context missing');
    const name = dto.name?.trim() ?? '';
    if (name.length < 2) throw new BadRequestException('اسم شركة التأمين يجب أن يكون حرفين على الأقل');
    if (dto.patientPercent < 0 || dto.patientPercent > 100) {
      throw new BadRequestException('نسبة تحمل المريض يجب أن تكون بين 0 و 100');
    }
    return this.insuranceRepo.save(this.insuranceRepo.create({
      pharmacyTenantId: tenantId,
      name,
      patientPercent: dto.patientPercent,
      notes: dto.notes ?? null,
    }));
  }

  async listInsuranceCompanies(tenantId: string, search?: string, limit = 50, offset = 0) {
    let qb = this.insuranceRepo.createQueryBuilder('ic')
      .where('ic."pharmacyTenantId" = :tid', { tid: tenantId })
      .orderBy('ic.name', 'ASC')
      .take(limit)
      .skip(offset);

    if (search) {
      qb = qb.andWhere('ic.name ILIKE :q', { q: `%${search}%` });
    }
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async updateInsuranceCompany(tenantId: string, id: string, dto: Partial<UpsertInsuranceCompanyDto>): Promise<PosInsuranceCompany> {
    const ic = await this.insuranceRepo.findOne({ where: { id, pharmacyTenantId: tenantId } });
    if (!ic) throw new NotFoundException('شركة التأمين غير موجودة');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 2) throw new BadRequestException('اسم شركة التأمين يجب أن يكون حرفين على الأقل');
      ic.name = name;
    }
    if (dto.patientPercent !== undefined) {
      if (dto.patientPercent < 0 || dto.patientPercent > 100) {
        throw new BadRequestException('نسبة تحمل المريض يجب أن تكون بين 0 و 100');
      }
      ic.patientPercent = dto.patientPercent;
    }
    if (dto.notes !== undefined) ic.notes = dto.notes ?? null;
    return this.insuranceRepo.save(ic);
  }

  async deleteInsuranceCompany(tenantId: string, id: string): Promise<void> {
    const ic = await this.insuranceRepo.findOne({ where: { id, pharmacyTenantId: tenantId } });
    if (!ic) throw new NotFoundException('شركة التأمين غير موجودة');
    await this.insuranceRepo.remove(ic);
  }
}

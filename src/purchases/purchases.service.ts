import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, DataSource, EntityManager, IsNull,
} from 'typeorm';
import { PurchaseInvoice }     from './entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from './entities/purchase-invoice-line.entity';
import { PurchaseReturn }      from './entities/purchase-return.entity';
import { PurchaseReturnLine }  from './entities/purchase-return-line.entity';
import { WishListItem }        from './entities/wish-list-item.entity';
import { PurchasePriceHistory } from './entities/purchase-price-history.entity';
import { CreateInvoiceDto }    from './dto/create-invoice.dto';
import { UpdateInvoiceDto }    from './dto/update-invoice.dto';
import { CreateReturnDto }     from './dto/create-return.dto';
import { InvoiceQueryDto, ReturnQueryDto } from './dto/invoice-query.dto';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly invoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseInvoiceLine)
    private readonly invoiceLineRepo: Repository<PurchaseInvoiceLine>,
    @InjectRepository(PurchaseReturn)
    private readonly returnRepo: Repository<PurchaseReturn>,
    @InjectRepository(PurchaseReturnLine)
    private readonly returnLineRepo: Repository<PurchaseReturnLine>,
    @InjectRepository(WishListItem)
    private readonly wishListRepo: Repository<WishListItem>,
    @InjectRepository(PurchasePriceHistory)
    private readonly priceHistoryRepo: Repository<PurchasePriceHistory>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── PO / RPO numbering (atomic per-tenant) ─────────────────────────────────

  private async nextPoNumber(tenantId: string, em: EntityManager): Promise<{ poNumber: string; poSequence: number }> {
    const row = await em.query(
      `SELECT COALESCE(MAX("poSequence"), 0) AS max_seq
       FROM purchase_invoices
       WHERE "pharmacyTenantId" = $1
       FOR UPDATE`,
      [tenantId],
    );
    const seq = Number(row[0].max_seq) + 1;
    const year = new Date().getFullYear();
    return { poNumber: `PO-${year}-${String(seq).padStart(5, '0')}`, poSequence: seq };
  }

  private async nextRpoNumber(tenantId: string, em: EntityManager): Promise<{ rpoNumber: string; rpoSequence: number }> {
    const row = await em.query(
      `SELECT COALESCE(MAX("rpoSequence"), 0) AS max_seq
       FROM purchase_returns
       WHERE "pharmacyTenantId" = $1
       FOR UPDATE`,
      [tenantId],
    );
    const seq = Number(row[0].max_seq) + 1;
    const year = new Date().getFullYear();
    return { rpoNumber: `RPO-${year}-${String(seq).padStart(5, '0')}`, rpoSequence: seq };
  }

  // ─── Line totals calc ────────────────────────────────────────────────────────

  private calcLineTotals(lines: any[]): { subtotal: number; totalTax: number } {
    let subtotal = 0;
    let totalTax = 0;
    for (const l of lines) {
      const qty = l.purchaseQty ?? 0;
      const price = l.purchasePrice ?? 0;
      const discPct = l.discountPct ?? 0;
      const taxPct = l.taxPct ?? 0;
      const base = qty * price;
      const discAmount = base * (discPct / 100);
      const afterDisc = base - discAmount;
      const tax = afterDisc * (taxPct / 100);
      l.taxAmount = +tax.toFixed(2);
      l.lineTotal = +(afterDisc + tax).toFixed(2);
      subtotal += afterDisc;
      totalTax += tax;
    }
    return { subtotal: +subtotal.toFixed(2), totalTax: +totalTax.toFixed(2) };
  }

  private calcInvoiceTotals(
    lines: any[],
    discountType: string,
    discountValue: number,
  ) {
    const { subtotal, totalTax } = this.calcLineTotals(lines);
    const totalDiscount = discountType === 'percent'
      ? +(subtotal * (discountValue / 100)).toFixed(2)
      : +Math.min(discountValue, subtotal).toFixed(2);
    const grandTotal = +(subtotal - totalDiscount + totalTax).toFixed(2);
    return { subtotal, totalTax, totalDiscount, grandTotal };
  }

  // ─── Price anomaly check ─────────────────────────────────────────────────────

  async checkPriceAnomaly(
    tenantId: string,
    productId: string,
    supplierTenantId: string | null,
    price: number,
  ) {
    const rows = await this.priceHistoryRepo
      .createQueryBuilder('h')
      .where('h.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('h.productId = :productId', { productId })
      .andWhere(supplierTenantId ? 'h.supplierTenantId = :sid' : '1=1', { sid: supplierTenantId })
      .orderBy('h.purchasedAt', 'DESC')
      .limit(10)
      .getMany();

    if (rows.length < 3) return null;

    const avg = rows.reduce((s, r) => s + Number(r.price), 0) / rows.length;
    const deviationPct = avg > 0 ? +((Math.abs(price - avg) / avg) * 100).toFixed(1) : 0;

    if (deviationPct <= 20) return null;

    return {
      hasAnomaly: true,
      deviationPct,
      historicalAvg: +avg.toFixed(2),
      direction: price > avg ? 'higher' : 'lower',
    };
  }

  // ─── Product search (for invoice creation) ──────────────────────────────────

  async searchProducts(tenantId: string, q: string, supplierId: string | null = null) {
    if (!q || q.length < 1) return [];
    const term = `%${q}%`;
    const params: any[] = [tenantId, term, q];
    if (supplierId) params.push(supplierId);
    const supplierFilter = supplierId ? `AND "supplierTenantId" = $${params.length}` : '';
    const rows = await this.dataSource.query(
      `SELECT
         i.id        AS "inventoryItemId",
         p.id,
         COALESCE(p."nameAr", p.name)  AS name,
         p.name                         AS "nameEn",
         p."nameAr",
         p.sku,
         p.barcode,
         i.quantity                     AS "currentStock",
         i."expiryDate",
         COALESCE(ph.price, i."costPrice", 0) AS "lastCostPrice",
         ph."supplierName"              AS "lastSupplierName"
       FROM inventory_items i
       JOIN products p ON p.id = i."productId"
       LEFT JOIN LATERAL (
         SELECT "supplierName", price
         FROM purchase_price_history
         WHERE "pharmacyTenantId" = $1
           AND "productId" = p.id
           ${supplierFilter}
         ORDER BY "purchasedAt" DESC
         LIMIT 1
       ) ph ON true
       WHERE i."pharmacyTenantId" = $1
         AND i."deletedAt" IS NULL
         AND (
           p.name          ILIKE $2
           OR p."nameAr"   ILIKE $2
           OR p."genericName" ILIKE $2
           OR p.sku        ILIKE $2
           OR p.barcode    = $3
           OR p.barcode    ILIKE $2
         )
       ORDER BY i.quantity DESC, p.name
       LIMIT 30`,
      params,
    );
    return rows;
  }

  async getPurchasedProductsForReturn(tenantId: string, supplierTenantId: string | null, q: string) {
    const term = `%${q}%`;
    const rows = await this.dataSource.query(
      `SELECT DISTINCT ON (l."productId")
         l."productId" AS id, l."productName" AS name, l."productSku" AS sku,
         l."batchNumber", l."expiryDate",
         COALESCE(inv.quantity, 0) AS "currentStock",
         l."purchasePrice" AS "lastPurchasePrice"
       FROM purchase_invoice_lines l
       JOIN purchase_invoices i ON i.id = l."invoiceId"
       LEFT JOIN inventory_items inv
         ON inv."productId" = l."productId"
        AND inv."pharmacyTenantId" = $1
        AND inv."deletedAt" IS NULL
       WHERE i."pharmacyTenantId" = $1
         AND i.status IN ('received','paid')
         AND ($2::uuid IS NULL OR l."supplierTenantId" = $2)
         AND (l."productName" ILIKE $3 OR l."productSku" ILIKE $3)
       ORDER BY l."productId", i."createdAt" DESC
       LIMIT 30`,
      [tenantId, supplierTenantId || null, term],
    );
    return rows;
  }

  async getSuppliers(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT
         COALESCE(i."supplierTenantId"::text, 'free_text_' || i."supplierName") AS id,
         i."supplierTenantId",
         i."supplierName" AS name,
         MAX(i."createdAt") AS "lastOrderDate"
       FROM purchase_invoices i
       WHERE i."pharmacyTenantId" = $1 AND i."deletedAt" IS NULL
       GROUP BY i."supplierTenantId", i."supplierName"
       ORDER BY MAX(i."createdAt") DESC
       LIMIT 100`,
      [tenantId],
    );
    return rows;
  }

  // ─── Invoices ────────────────────────────────────────────────────────────────

  async createInvoice(tenantId: string, dto: CreateInvoiceDto, userId: string) {
    return this.dataSource.transaction(async (em) => {
      const { poNumber, poSequence } = await this.nextPoNumber(tenantId, em);

      const lines = (dto.lines ?? []).map((l, i) => ({
        ...l,
        supplierTenantId: dto.supplierTenantId ?? l.supplierTenantId ?? null,
        sortOrder: l.sortOrder ?? i,
        taxAmount: 0,
        lineTotal: 0,
      }));

      const totals = this.calcInvoiceTotals(lines, dto.discountType ?? 'percent', dto.discountValue ?? 0);

      const invoice = em.create(PurchaseInvoice, {
        pharmacyTenantId: tenantId,
        poNumber,
        poSequence,
        supplierTenantId: dto.supplierTenantId ?? null,
        supplierName: dto.supplierName,
        supplierInvoiceNumber: dto.supplierInvoiceNumber ?? null,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
        paymentMethod: (dto.paymentMethod ?? 'cash') as any,
        paymentStatus: 'pending',
        status: 'draft',
        discountType: (dto.discountType ?? 'percent') as any,
        discountValue: dto.discountValue ?? 0,
        ...totals,
        notes: dto.notes ?? null,
        createdBy: userId,
      });

      const saved = await em.save(PurchaseInvoice, invoice);

      const lineEntities = lines.map(l =>
        em.create(PurchaseInvoiceLine, { ...l, invoiceId: saved.id }),
      );
      await em.save(PurchaseInvoiceLine, lineEntities);

      return em.findOne(PurchaseInvoice, {
        where: { id: saved.id },
        relations: ['lines'],
      });
    });
  }

  async getInvoices(tenantId: string, query: InvoiceQueryDto) {
    const page  = Math.max(1, parseInt(query.page  ?? '1', 10));
    const limit = Math.min(100, parseInt(query.limit ?? '20', 10));

    const qb = this.invoiceRepo
      .createQueryBuilder('i')
      .where('i.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('i.deletedAt IS NULL')
      .select([
        'i.id', 'i.poNumber', 'i.supplierName', 'i.supplierTenantId',
        'i.invoiceDate', 'i.status', 'i.paymentStatus', 'i.paymentMethod',
        'i.grandTotal', 'i.totalDiscount', 'i.createdAt',
      ]);

    if (query.q) {
      qb.andWhere('(i.poNumber ILIKE :q OR i.supplierName ILIKE :q OR i.supplierInvoiceNumber ILIKE :q)', { q: `%${query.q}%` });
    }
    if (query.status) {
      qb.andWhere('i.status = :status', { status: query.status });
    }
    if (query.paymentStatus) {
      qb.andWhere('i.paymentStatus = :ps', { ps: query.paymentStatus });
    }
    if (query.supplierId) {
      qb.andWhere('i.supplierTenantId = :sid', { sid: query.supplierId });
    }
    if (query.dateFrom) {
      qb.andWhere('i.createdAt >= :from', { from: query.dateFrom });
    }
    if (query.dateTo) {
      qb.andWhere('i.createdAt <= :to', { to: `${query.dateTo}T23:59:59` });
    }

    const [items, total] = await qb
      .orderBy('i.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getInvoiceById(tenantId: string, id: string) {
    const inv = await this.invoiceRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: IsNull() },
      relations: ['lines'],
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  async updateInvoice(tenantId: string, id: string, dto: UpdateInvoiceDto) {
    return this.dataSource.transaction(async (em) => {
      const invoice = await em.findOne(PurchaseInvoice, {
        where: { id, pharmacyTenantId: tenantId, deletedAt: null },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== 'draft') {
        throw new BadRequestException('Only draft invoices can be edited');
      }

      const lines = (dto.lines ?? []).map((l, i) => ({
        ...l,
        supplierTenantId: dto.supplierTenantId ?? l.supplierTenantId ?? null,
        sortOrder: l.sortOrder ?? i,
        taxAmount: 0,
        lineTotal: 0,
      }));

      const discountType  = dto.discountType  ?? invoice.discountType;
      const discountValue = dto.discountValue ?? invoice.discountValue;
      const totals = this.calcInvoiceTotals(lines, discountType, discountValue);

      await em.delete(PurchaseInvoiceLine, { invoiceId: id });

      Object.assign(invoice, {
        supplierTenantId: dto.supplierTenantId ?? invoice.supplierTenantId,
        supplierName: dto.supplierName ?? invoice.supplierName,
        supplierInvoiceNumber: dto.supplierInvoiceNumber ?? invoice.supplierInvoiceNumber,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : invoice.invoiceDate,
        paymentMethod: dto.paymentMethod ?? invoice.paymentMethod,
        discountType,
        discountValue,
        notes: dto.notes ?? invoice.notes,
        ...totals,
      });

      await em.save(PurchaseInvoice, invoice);

      const lineEntities = lines.map(l =>
        em.create(PurchaseInvoiceLine, { ...l, invoiceId: id }),
      );
      await em.save(PurchaseInvoiceLine, lineEntities);

      return em.findOne(PurchaseInvoice, { where: { id }, relations: ['lines'] });
    });
  }

  async confirmInvoice(tenantId: string, id: string, userId: string) {
    return this.dataSource.transaction(async (em) => {
      const invoice = await em.findOne(PurchaseInvoice, {
        where: { id, pharmacyTenantId: tenantId, deletedAt: null },
        relations: ['lines'],
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== 'draft') {
        throw new BadRequestException(`Cannot confirm invoice in '${invoice.status}' state`);
      }

      invoice.status = 'received';
      invoice.confirmedAt = new Date();
      await em.save(PurchaseInvoice, invoice);

      // Update inventory + record price history
      for (const line of invoice.lines) {
        await this.upsertInventoryItem(em, tenantId, line);

        await em.save(PurchasePriceHistory, em.create(PurchasePriceHistory, {
          pharmacyTenantId: tenantId,
          productId: line.productId,
          supplierTenantId: invoice.supplierTenantId ?? null,
          supplierName: invoice.supplierName,
          price: line.purchasePrice,
          invoiceId: invoice.id,
          purchasedAt: new Date(),
        }));
      }

      // Remove from wish list if now stocked
      await this.syncWishListAfterReceive(em, tenantId, invoice.lines.map(l => l.productId));

      return em.findOne(PurchaseInvoice, { where: { id }, relations: ['lines'] });
    });
  }

  private async upsertInventoryItem(em: EntityManager, tenantId: string, line: PurchaseInvoiceLine) {
    const existing = await em.query(
      `SELECT id, quantity FROM inventory_items
       WHERE "pharmacyTenantId" = $1
         AND "productId" = $2
         AND ("batchNumber" = $3 OR ($3 IS NULL AND "batchNumber" IS NULL))
         AND ("expiryDate" = $4 OR ($4 IS NULL AND "expiryDate" IS NULL))
         AND "deletedAt" IS NULL
       LIMIT 1`,
      [tenantId, line.productId, line.batchNumber ?? null, line.expiryDate ?? null],
    );

    const totalQty = line.purchaseQty + (line.freeGoodsQty ?? 0);

    if (existing.length > 0) {
      await em.query(
        `UPDATE inventory_items
         SET quantity = quantity + $1,
             "costPrice" = $2,
             "sellingPrice" = CASE WHEN $3 > 0 THEN $3 ELSE "sellingPrice" END,
             "updatedAt" = now()
         WHERE id = $4`,
        [totalQty, line.purchasePrice, line.salePrice ?? 0, existing[0].id],
      );
    } else {
      await em.query(
        `INSERT INTO inventory_items
           ("pharmacyTenantId", "productId", quantity, "costPrice", "sellingPrice",
            "batchNumber", "expiryDate", "minThreshold", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, now(), now())`,
        [
          tenantId,
          line.productId,
          totalQty,
          line.purchasePrice,
          line.salePrice ?? line.purchasePrice,
          line.batchNumber ?? null,
          line.expiryDate ?? null,
        ],
      );
    }
  }

  private async syncWishListAfterReceive(em: EntityManager, tenantId: string, productIds: string[]) {
    if (!productIds.length) return;
    for (const productId of productIds) {
      const row = await em.query(
        `SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_items
         WHERE "pharmacyTenantId" = $1 AND "productId" = $2 AND "deletedAt" IS NULL`,
        [tenantId, productId],
      );
      const stock = Number(row[0]?.total ?? 0);
      const wish = await em.findOne(WishListItem, {
        where: { pharmacyTenantId: tenantId, productId },
      });
      if (wish && stock >= wish.requestedQty) {
        await em.remove(WishListItem, wish);
      } else if (wish) {
        wish.currentStock = stock;
        await em.save(WishListItem, wish);
      }
    }
  }

  async markInvoicePaid(tenantId: string, id: string) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'received') {
      throw new BadRequestException('Only received invoices can be marked as paid');
    }
    invoice.paymentStatus = 'paid';
    invoice.status = 'paid';
    return this.invoiceRepo.save(invoice);
  }

  async cancelInvoice(tenantId: string, id: string, userId: string) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!['draft'].includes(invoice.status)) {
      throw new BadRequestException('Only draft invoices can be cancelled');
    }
    invoice.status = 'cancelled';
    invoice.cancelledAt = new Date();
    invoice.cancelledBy = userId;
    return this.invoiceRepo.save(invoice);
  }

  async deleteInvoice(tenantId: string, id: string) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'draft') {
      throw new BadRequestException('Only draft invoices can be deleted');
    }
    invoice.deletedAt = new Date();
    await this.invoiceRepo.save(invoice);
  }

  async getInvoiceStats(tenantId: string) {
    const [totals, pendingPay, wishList] = await Promise.all([
      this.dataSource.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('received','paid')
             AND DATE_TRUNC('month', "confirmedAt") = DATE_TRUNC('month', NOW())
           ) AS "thisMonthCount",
           COALESCE(SUM("grandTotal") FILTER (WHERE status IN ('received','paid')
             AND DATE_TRUNC('month', "confirmedAt") = DATE_TRUNC('month', NOW())
           ), 0) AS "thisMonthValue",
           COUNT(*) FILTER (WHERE status IN ('received','paid')) AS "totalInvoices",
           COALESCE(SUM("grandTotal") FILTER (WHERE status IN ('received','paid')), 0) AS "totalSpent",
           COALESCE(SUM("grandTotal") FILTER (WHERE "paymentStatus" = 'pending' AND status IN ('received','paid')), 0) AS "totalPending",
           COUNT(*) FILTER (WHERE status = 'draft') AS "draftCount"
         FROM purchase_invoices
         WHERE "pharmacyTenantId" = $1 AND "deletedAt" IS NULL`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS cnt FROM purchase_invoices
         WHERE "pharmacyTenantId" = $1 AND "paymentStatus" = 'pending'
           AND status IN ('received','paid') AND "deletedAt" IS NULL`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS cnt FROM wish_list_items WHERE "pharmacyTenantId" = $1`,
        [tenantId],
      ),
    ]);

    return {
      ...totals[0],
      pendingPaymentCount: Number(pendingPay[0]?.cnt ?? 0),
      wishListCount: Number(wishList[0]?.cnt ?? 0),
    };
  }

  // ─── Returns ─────────────────────────────────────────────────────────────────

  async createReturn(tenantId: string, dto: CreateReturnDto, userId: string) {
    return this.dataSource.transaction(async (em) => {
      const { rpoNumber, rpoSequence } = await this.nextRpoNumber(tenantId, em);

      const lines = (dto.lines ?? []).map((l) => ({
        ...l,
        taxAmount: 0,
        lineTotal: 0,
      }));

      let subtotal = 0;
      let totalTax = 0;
      for (const l of lines) {
        const qty = l.returnQty ?? 0;
        const price = l.returnPrice ?? 0;
        const discPct = l.discountPct ?? 0;
        const taxPct = l.taxPct ?? 0;
        const base = qty * price;
        const discAmount = base * (discPct / 100);
        const afterDisc = base - discAmount;
        const tax = afterDisc * (taxPct / 100);
        l.taxAmount = +tax.toFixed(2);
        l.lineTotal = +(afterDisc + tax).toFixed(2);
        subtotal += afterDisc;
        totalTax += tax;
      }

      const discountValue = dto.discountValue ?? 0;
      const discountType = dto.discountType ?? 'percent';
      const totalDiscount = discountType === 'percent'
        ? +(subtotal * (discountValue / 100)).toFixed(2)
        : +Math.min(discountValue, subtotal).toFixed(2);
      const grandTotal = +(subtotal - totalDiscount + totalTax).toFixed(2);

      const ret = em.create(PurchaseReturn, {
        pharmacyTenantId: tenantId,
        rpoNumber,
        rpoSequence,
        supplierTenantId: dto.supplierTenantId ?? null,
        supplierName: dto.supplierName,
        supplierInvoiceDate: dto.supplierInvoiceDate ? new Date(dto.supplierInvoiceDate) : null,
        supplierInvoiceNumber: dto.supplierInvoiceNumber ?? null,
        paymentMethod: dto.paymentMethod ?? 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountType,
        discountValue,
        subtotal: +subtotal.toFixed(2),
        totalDiscount,
        totalTax: +totalTax.toFixed(2),
        grandTotal,
        notes: dto.notes ?? null,
        createdBy: userId,
      });

      const saved = await em.save(PurchaseReturn, ret);

      const lineEntities = lines.map(l =>
        em.create(PurchaseReturnLine, { ...l, returnId: saved.id }),
      );
      await em.save(PurchaseReturnLine, lineEntities);

      return em.findOne(PurchaseReturn, { where: { id: saved.id }, relations: ['lines'] });
    });
  }

  async getReturns(tenantId: string, query: ReturnQueryDto) {
    const page  = Math.max(1, parseInt(query.page  ?? '1', 10));
    const limit = Math.min(100, parseInt(query.limit ?? '20', 10));

    const qb = this.returnRepo
      .createQueryBuilder('r')
      .where('r.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('r.deletedAt IS NULL')
      .select(['r.id', 'r.rpoNumber', 'r.supplierName', 'r.status', 'r.grandTotal', 'r.createdAt']);

    if (query.q) {
      qb.andWhere('(r.rpoNumber ILIKE :q OR r.supplierName ILIKE :q)', { q: `%${query.q}%` });
    }
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.supplierId) qb.andWhere('r.supplierTenantId = :sid', { sid: query.supplierId });
    if (query.dateFrom) qb.andWhere('r.createdAt >= :from', { from: query.dateFrom });
    if (query.dateTo)   qb.andWhere('r.createdAt <= :to',   { to: `${query.dateTo}T23:59:59` });

    const [items, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getReturnById(tenantId: string, id: string) {
    const ret = await this.returnRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: null },
      relations: ['lines'],
    });
    if (!ret) throw new NotFoundException('Return not found');
    return ret;
  }

  async confirmReturn(tenantId: string, id: string) {
    return this.dataSource.transaction(async (em) => {
      const ret = await em.findOne(PurchaseReturn, {
        where: { id, pharmacyTenantId: tenantId, deletedAt: null },
        relations: ['lines'],
      });
      if (!ret) throw new NotFoundException('Return not found');
      if (ret.status !== 'draft') throw new BadRequestException('Only draft returns can be confirmed');
      if (!ret.supplierInvoiceDate) throw new BadRequestException('Please enter the date of the original supplier invoice.');

      // Validate each line: returnQty must not exceed available stock
      for (const line of ret.lines) {
        const [stockRow] = await em.query(
          `SELECT COALESCE(SUM(quantity), 0) AS available
           FROM inventory_items
           WHERE "pharmacyTenantId" = $1 AND "productId" = $2
             AND ("batchNumber" = $3 OR ($3 IS NULL AND "batchNumber" IS NULL))
             AND "deletedAt" IS NULL`,
          [tenantId, line.productId, line.batchNumber ?? null],
        );
        const available = Number(stockRow.available);
        if ((line.returnQty ?? 0) > available) {
          throw new BadRequestException(
            `You only have ${available} units of "${line.productName}" available to return.`,
          );
        }
      }

      ret.status = 'confirmed';
      ret.confirmedAt = new Date();
      await em.save(PurchaseReturn, ret);

      for (const line of ret.lines) {
        const deductQty = (line.returnQty ?? 0) + (line.freeGoodsQty ?? 0);
        if (deductQty <= 0) continue;
        await em.query(
          `UPDATE inventory_items
           SET quantity = GREATEST(0, quantity - $1), "updatedAt" = now()
           WHERE "pharmacyTenantId" = $2 AND "productId" = $3
             AND ("batchNumber" = $4 OR ($4 IS NULL AND "batchNumber" IS NULL))
             AND "deletedAt" IS NULL`,
          [deductQty, tenantId, line.productId, line.batchNumber ?? null],
        );
      }

      return em.findOne(PurchaseReturn, { where: { id }, relations: ['lines'] });
    });
  }

  async cancelReturn(tenantId: string, id: string) {
    const ret = await this.returnRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: null },
    });
    if (!ret) throw new NotFoundException('Return not found');
    if (ret.status !== 'draft') throw new BadRequestException('Only draft returns can be cancelled');
    ret.status = 'cancelled';
    return this.returnRepo.save(ret);
  }

  // ─── Wish list ───────────────────────────────────────────────────────────────

  async getWishList(tenantId: string) {
    return this.wishListRepo.find({
      where: { pharmacyTenantId: tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async addWishListItem(tenantId: string, dto: {
    productId: string; productName: string; productSku?: string;
    requestedQty: number; lastSupplierId?: string; lastSupplierName?: string;
  }) {
    const existing = await this.wishListRepo.findOne({
      where: { pharmacyTenantId: tenantId, productId: dto.productId },
    });
    if (existing) {
      existing.requestedQty = dto.requestedQty;
      if (dto.lastSupplierId) existing.lastSupplierId = dto.lastSupplierId;
      if (dto.lastSupplierName) existing.lastSupplierName = dto.lastSupplierName;
      return this.wishListRepo.save(existing);
    }

    const stockRow = await this.dataSource.query(
      `SELECT COALESCE(SUM(quantity),0) AS stock FROM inventory_items
       WHERE "pharmacyTenantId" = $1 AND "productId" = $2 AND "deletedAt" IS NULL`,
      [tenantId, dto.productId],
    );

    const item = this.wishListRepo.create({
      pharmacyTenantId: tenantId,
      ...dto,
      currentStock: Number(stockRow[0]?.stock ?? 0),
      source: 'manual',
    });
    return this.wishListRepo.save(item);
  }

  async updateWishListItem(tenantId: string, id: string, dto: { requestedQty?: number; lastSupplierId?: string; lastSupplierName?: string }) {
    const item = await this.wishListRepo.findOne({ where: { id, pharmacyTenantId: tenantId } });
    if (!item) throw new NotFoundException('Wish list item not found');
    Object.assign(item, dto);
    return this.wishListRepo.save(item);
  }

  async removeWishListItem(tenantId: string, id: string) {
    const item = await this.wishListRepo.findOne({ where: { id, pharmacyTenantId: tenantId } });
    if (!item) throw new NotFoundException('Wish list item not found');
    await this.wishListRepo.remove(item);
  }

  async createOrdersFromWishList(tenantId: string, itemIds: string[], userId: string) {
    const items = await this.wishListRepo.find({
      where: itemIds.length
        ? itemIds.map(id => ({ id, pharmacyTenantId: tenantId }))
        : [{ pharmacyTenantId: tenantId }],
    });
    if (!items.length) throw new BadRequestException('No wish list items found');

    // Group by supplier
    const groups = new Map<string, { supplierName: string; supplierId: string | null; items: WishListItem[] }>();
    for (const item of items) {
      const key = item.lastSupplierId ?? '_unknown';
      if (!groups.has(key)) {
        groups.set(key, {
          supplierName: item.lastSupplierName ?? 'غير محدد',
          supplierId: item.lastSupplierId ?? null,
          items: [],
        });
      }
      groups.get(key).items.push(item);
    }

    const created: PurchaseInvoice[] = [];
    for (const [, group] of groups) {
      const lines = group.items.map((item, i) => ({
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku ?? null,
        purchaseQty: item.requestedQty,
        purchasePrice: 0,
        sortOrder: i,
        taxAmount: 0,
        lineTotal: 0,
      }));

      const inv = await this.createInvoice(tenantId, {
        supplierTenantId: group.supplierId,
        supplierName: group.supplierName,
        discountType: 'percent',
        discountValue: 0,
        lines: lines as any,
      }, userId);

      // Tag wish list items with draft PO
      for (const item of group.items) {
        item.draftPoId = inv.id;
        item.draftPoNumber = inv.poNumber;
        await this.wishListRepo.save(item);
      }

      created.push(inv);
    }

    return created;
  }

  // ─── Nightly wish list auto-populate (called by cron) ────────────────────────

  async autoPopulateWishList(tenantId: string) {
    const lowStock = await this.dataSource.query(
      `SELECT DISTINCT ON (inv."productId")
         inv."productId", p.name AS "productName", p.sku AS "productSku",
         SUM(inv.quantity) OVER (PARTITION BY inv."productId") AS "totalStock",
         inv."minThreshold",
         (inv."minThreshold" * 2) AS "recommendedQty",
         ph."supplierName" AS "lastSupplierName",
         ph."supplierTenantId" AS "lastSupplierId"
       FROM inventory_items inv
       JOIN products p ON p.id = inv."productId"
       LEFT JOIN LATERAL (
         SELECT "supplierName", "supplierTenantId"
         FROM purchase_price_history
         WHERE "pharmacyTenantId" = $1 AND "productId" = inv."productId"
         ORDER BY "purchasedAt" DESC LIMIT 1
       ) ph ON true
       WHERE inv."pharmacyTenantId" = $1 AND inv."deletedAt" IS NULL
         AND inv."minThreshold" > 0`,
      [tenantId],
    );

    let upserted = 0;
    for (const row of lowStock) {
      const stock = Number(row.totalStock ?? 0);
      if (stock > Number(row.minThreshold ?? 0)) continue;

      const existing = await this.wishListRepo.findOne({
        where: { pharmacyTenantId: tenantId, productId: row.productId },
      });

      if (existing) {
        existing.currentStock = stock;
        existing.source = 'auto';
        await this.wishListRepo.save(existing);
      } else {
        await this.wishListRepo.save(this.wishListRepo.create({
          pharmacyTenantId: tenantId,
          productId: row.productId,
          productName: row.productName,
          productSku: row.productSku,
          currentStock: stock,
          requestedQty: Number(row.recommendedQty ?? 1),
          recommendedQty: Number(row.recommendedQty ?? 1),
          lastSupplierId: row.lastSupplierId ?? null,
          lastSupplierName: row.lastSupplierName ?? null,
          source: 'auto',
        }));
        upserted++;
      }
    }

    return { upserted };
  }
}

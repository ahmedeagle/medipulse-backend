import {
  Injectable, Logger, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, DataSource, EntityManager, IsNull, In,
} from 'typeorm';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { PurchaseInvoice }     from './entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from './entities/purchase-invoice-line.entity';
import { PurchaseReturn }      from './entities/purchase-return.entity';
import { PurchaseReturnLine }  from './entities/purchase-return-line.entity';
import { WishListItem }        from './entities/wish-list-item.entity';
import { PurchasePriceHistory } from './entities/purchase-price-history.entity';
import { PurchaseInvoiceChangelog, ChangeEntry } from './entities/purchase-invoice-changelog.entity';
import { CreateInvoiceDto }    from './dto/create-invoice.dto';
import { UpdateInvoiceDto }    from './dto/update-invoice.dto';
import { CreateReturnDto }     from './dto/create-return.dto';
import { InvoiceQueryDto, ReturnQueryDto } from './dto/invoice-query.dto';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';
import { NotificationService } from '../notifications/notification.service';

const FIELD_LABELS: Record<string, string> = {
  supplierName:          'اسم المورد',
  supplierInvoiceNumber: 'رقم فاتورة المورد',
  invoiceDate:           'تاريخ الفاتورة',
  paymentMethod:         'طريقة الدفع',
  notes:                 'الملاحظات',
  discountType:          'نوع الخصم',
  discountValue:         'قيمة الخصم',
};

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

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
    @InjectRepository(PurchaseInvoiceChangelog)
    private readonly changelogRepo: Repository<PurchaseInvoiceChangelog>,
    private readonly dataSource: DataSource,
    private readonly pharmacySettings: PharmacySettingsService,
    private readonly notificationSvc: NotificationService,
  ) {}

  private async writeChangelog(
    invoiceId: string,
    tenantId: string,
    userId: string | null,
    action: PurchaseInvoiceChangelog['action'],
    changes: ChangeEntry[],
  ): Promise<void> {
    try {
      await this.changelogRepo.save(this.changelogRepo.create({ invoiceId, tenantId, userId, action, changes }));
    } catch (e: any) {
      this.logger.warn(`changelog write failed: ${e.message}`);
    }
  }

  private diffInvoice(before: PurchaseInvoice, dto: UpdateInvoiceDto, hasLineChanges: boolean): ChangeEntry[] {
    const changes: ChangeEntry[] = [];
    const TRACKED = ['supplierName', 'supplierInvoiceNumber', 'invoiceDate', 'paymentMethod', 'notes', 'discountType', 'discountValue'] as const;
    for (const field of TRACKED) {
      const oldVal = before[field] != null ? String(before[field]) : '';
      const newVal = dto[field] != null ? String(dto[field]) : '';
      if (oldVal !== newVal) {
        changes.push({ field, fieldLabel: FIELD_LABELS[field] ?? field, oldValue: oldVal || null, newValue: newVal || null });
      }
    }
    if (hasLineChanges) {
      changes.push({ field: 'lines', fieldLabel: 'بنود المنتجات', oldValue: null, newValue: 'تم التحديث' });
    }
    return changes;
  }

  // ─── PO / RPO numbering (atomic per-tenant) ─────────────────────────────────
  //
  // Backed by `tenant_po_counters` (migration 1780706000000). The previous
  // implementation locked every row in purchase_invoices/purchase_returns
  // for the tenant via `SELECT … FOR UPDATE`, serializing invoice creation
  // across the whole pharmacy. The counter table is a single-row UPSERT
  // that holds a row lock for microseconds.

  private async nextPoNumber(tenantId: string, em: EntityManager): Promise<{ poNumber: string; poSequence: number }> {
    const row = await em.query(
      `INSERT INTO "tenant_po_counters" ("tenantId", "lastPo", "lastRpo", "updatedAt")
         VALUES ($1, 1, 0, now())
       ON CONFLICT ("tenantId") DO UPDATE SET
         "lastPo" = "tenant_po_counters"."lastPo" + 1,
         "updatedAt" = now()
       RETURNING "lastPo" AS seq`,
      [tenantId],
    );
    const seq = Number(row[0].seq);
    const year = new Date().getFullYear();
    return { poNumber: `PO-${year}-${String(seq).padStart(5, '0')}`, poSequence: seq };
  }

  private async nextRpoNumber(tenantId: string, em: EntityManager): Promise<{ rpoNumber: string; rpoSequence: number }> {
    const row = await em.query(
      `INSERT INTO "tenant_po_counters" ("tenantId", "lastPo", "lastRpo", "updatedAt")
         VALUES ($1, 0, 1, now())
       ON CONFLICT ("tenantId") DO UPDATE SET
         "lastRpo" = "tenant_po_counters"."lastRpo" + 1,
         "updatedAt" = now()
       RETURNING "lastRpo" AS seq`,
      [tenantId],
    );
    const seq = Number(row[0].seq);
    const year = new Date().getFullYear();
    return { rpoNumber: `RPO-${year}-${String(seq).padStart(5, '0')}`, rpoSequence: seq };
  }

  // ─── Line totals calc ────────────────────────────────────────────────────────

  /**
   * Money-safe round to 2 decimal places. Uses `Math.round(x * 100) / 100`
   * which avoids the silent precision loss of `+x.toFixed(2)` when chained
   * across many additions. Negative inputs are clamped to 0 — pharmacy
   * invoices never carry credit-style negative line totals.
   */
  private money(n: number): number {
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  private calcLineTotals(lines: any[]): { subtotal: number; totalTax: number } {
    let subtotal = 0;
    let totalTax = 0;
    for (const l of lines) {
      // Defensive coercion + clamp — guards against malformed OCR or
      // hand-edited DTO payloads that could otherwise produce a negative or
      // NaN grand total.
      const qty       = Math.max(0, Number(l.purchaseQty) || 0);
      const price     = Math.max(0, Number(l.purchasePrice) || 0);
      const discPct   = Math.min(100, Math.max(0, Number(l.discountPct) || 0));
      const taxPct    = Math.max(0,             Number(l.taxPct)      || 0);

      // Round every intermediate at the cent boundary so the persisted
      // line totals equal the visible line totals; summing rounded values
      // keeps the grand total identical to what the user sees on screen.
      const base       = this.money(qty * price);
      const discAmount = this.money(base * (discPct / 100));
      const afterDisc  = this.money(base - discAmount);
      const tax        = this.money(afterDisc * (taxPct / 100));

      l.taxAmount = tax;
      l.lineTotal = this.money(afterDisc + tax);
      subtotal   += afterDisc;
      totalTax   += tax;
    }
    return { subtotal: this.money(subtotal), totalTax: this.money(totalTax) };
  }

  private calcInvoiceTotals(
    lines: any[],
    discountType: string,
    discountValue: number,
    vatMode: 'tax_on_net' | 'tax_on_gross' = 'tax_on_net',
  ) {
    const { subtotal, totalTax } = this.calcLineTotals(lines);
    const dv = Math.max(0, Number(discountValue) || 0);
    const totalDiscount = discountType === 'percent'
      ? this.money(subtotal * (Math.min(100, dv) / 100))
      : this.money(Math.min(dv, subtotal));

    // VAT model selection — see TaxSettings.vatCalculationMode docs.
    //  tax_on_net (default, EG/GCC): invoice-level discount also reduces VAT.
    //    We scale the per-line tax pro-rata against the post-discount subtotal
    //    so each line still carries an accurate `taxAmount` (used by reports).
    //  tax_on_gross: legacy behaviour — VAT stays on pre-discount subtotal.
    let adjustedTax = totalTax;
    if (vatMode === 'tax_on_net' && totalDiscount > 0 && subtotal > 0) {
      const taxableAfterInvDisc = this.money(subtotal - totalDiscount);
      const effectiveTaxRate    = totalTax / subtotal;
      adjustedTax               = this.money(taxableAfterInvDisc * effectiveTaxRate);
      // Re-distribute the adjustment proportionally across line.taxAmount so
      // per-line reports stay consistent with the invoice grand total.
      if (totalTax > 0) {
        const ratio = adjustedTax / totalTax;
        for (const l of lines) {
          const oldTax    = Number(l.taxAmount) || 0;
          const afterDisc = (Number(l.lineTotal) || 0) - oldTax;
          const newTax    = this.money(oldTax * ratio);
          l.taxAmount = newTax;
          l.lineTotal = this.money(afterDisc + newTax);
        }
      }
    }

    const grandTotal = this.money(subtotal - totalDiscount + adjustedTax);
    return { subtotal, totalTax: adjustedTax, totalDiscount, grandTotal };
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

    // Search the global products catalog with a LEFT JOIN to inventory.
    // This returns BOTH stocked products (with real currentStock) AND catalog
    // products the pharmacy has never purchased (currentStock = 0, inInventory = false).
    // DISTINCT ON (p.id) ensures one row per product even if multiple batch rows exist.
    const rows = await this.dataSource.query(
      `SELECT DISTINCT ON (p.id)
         i.id        AS "inventoryItemId",
         p.id,
         COALESCE(p."nameAr", p.name)  AS name,
         p.name                         AS "nameEn",
         p."nameAr",
         p.sku,
         p.barcode,
         COALESCE(
           (SELECT COALESCE(SUM(ii.quantity), 0)
            FROM inventory_items ii
            WHERE ii."productId" = p.id
              AND ii."pharmacyTenantId" = $1
              AND ii."deletedAt" IS NULL),
           0
         )::int                         AS "currentStock",
         i."expiryDate",
         COALESCE(ph.price, i."costPrice", 0) AS "lastCostPrice",
         ph."supplierName"              AS "lastSupplierName",
         (i.id IS NOT NULL)             AS "inInventory"
       FROM products p
       LEFT JOIN inventory_items i
         ON i."productId" = p.id
         AND i."pharmacyTenantId" = $1
         AND i."deletedAt" IS NULL
       LEFT JOIN LATERAL (
         SELECT "supplierName", price
         FROM purchase_price_history
         WHERE "pharmacyTenantId" = $1
           AND "productId" = p.id
           ${supplierFilter}
         ORDER BY "purchasedAt" DESC
         LIMIT 1
       ) ph ON true
       WHERE p."isActive" = true
         AND (p."disablePurchase" IS NOT TRUE)
         AND (
           p.name          ILIKE $2
           OR p."nameAr"   ILIKE $2
           OR p."genericName" ILIKE $2
           OR p.sku        ILIKE $2
           OR p.barcode    = $3
           OR p.barcode    ILIKE $2
         )
       ORDER BY p.id,
         CASE WHEN i.id IS NOT NULL THEN 0 ELSE 1 END,
         i.quantity DESC NULLS LAST
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
    this.logger.log(`createInvoice start — tenant=${tenantId} supplier="${dto.supplierName}" lines=${dto.lines?.length ?? 0} userId=${userId}`);
    let createdId: string | null = null;
    try {
    const invoice = await this.dataSource.transaction(async (em) => {
      const { poNumber, poSequence } = await this.nextPoNumber(tenantId, em);

      const lines = (dto.lines ?? []).map((l, i) => ({
        ...l,
        supplierTenantId: dto.supplierTenantId ?? l.supplierTenantId ?? null,
        sortOrder: l.sortOrder ?? i,
        taxAmount: 0,
        lineTotal: 0,
      }));

      const settings = await this.pharmacySettings.getSettings(tenantId);
      const vatMode  = settings.taxSettings?.vatCalculationMode ?? 'tax_on_net';
      const totals = this.calcInvoiceTotals(
        lines,
        dto.discountType ?? 'percent',
        dto.discountValue ?? 0,
        vatMode,
      );

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
    createdId = invoice?.id ?? null;
    if (createdId) {
      await this.writeChangelog(createdId, tenantId, userId, 'created', []);
    }
    return invoice;
    } catch (err) {
      this.logger.error(
        `createInvoice FAILED — tenant=${tenantId} supplier="${dto.supplierName}"`,
        err?.message,
        err?.stack,
      );
      throw err;
    }
  }

  async getInvoices(tenantId: string, query: InvoiceQueryDto) {
    const page   = Math.max(1, parseInt(query.page  ?? '1',  10));
    const limit  = Math.min(100, parseInt(query.limit ?? '20', 10));
    const offset = (page - 1) * limit;

    const conditions: string[] = [
      `i."pharmacyTenantId" = $1`,
      `i."deletedAt" IS NULL`,
    ];
    const params: any[] = [tenantId];

    if (query.q) {
      params.push(`%${query.q}%`);
      const p = params.length;
      conditions.push(`(i."poNumber" ILIKE $${p} OR i."supplierName" ILIKE $${p} OR i."supplierInvoiceNumber" ILIKE $${p})`);
    }
    if (query.status) {
      params.push(query.status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (query.paymentStatus) {
      params.push(query.paymentStatus);
      conditions.push(`i."paymentStatus" = $${params.length}`);
    }
    if (query.supplierId) {
      params.push(query.supplierId);
      conditions.push(`i."supplierTenantId" = $${params.length}`);
    }
    if (query.dateFrom) {
      params.push(query.dateFrom);
      conditions.push(`i."createdAt" >= $${params.length}`);
    }
    if (query.dateTo) {
      params.push(`${query.dateTo}T23:59:59`);
      conditions.push(`i."createdAt" <= $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const dataParams = [...params, limit, offset];

    const [rows, countResult] = await Promise.all([
      this.dataSource.query(
        `SELECT
           i.id, i."poNumber", i."supplierName", i."supplierTenantId",
           i."supplierInvoiceNumber", i."invoiceDate",
           i.status, i."paymentStatus", i."paymentMethod",
           i."grandTotal", i."totalDiscount", i."createdAt", i."updatedAt",
           COALESCE(i.source, 'manual') AS source,
           (SELECT COUNT(*) FROM purchase_invoice_lines WHERE "invoiceId" = i.id)::int AS "linesCount"
         FROM purchase_invoices i
         WHERE ${where}
         ORDER BY i."createdAt" DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams,
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS total FROM purchase_invoices i WHERE ${where}`,
        params,
      ),
    ]);

    const total = parseInt(countResult[0].total, 10);
    return {
      items: rows,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getInvoiceChangelog(tenantId: string, invoiceId: string) {
    const rows = await this.dataSource.query(
      `SELECT
         c.id, c."invoiceId", c."userId", c.action, c.changes, c."createdAt",
         CONCAT(u."firstName", ' ', u."lastName") AS "userName",
         u.email AS "userEmail"
       FROM purchase_invoice_changelogs c
       LEFT JOIN users u ON u."kcId" = c."userId"::text
       WHERE c."invoiceId" = $1 AND c."tenantId" = $2
       ORDER BY c."createdAt" ASC`,
      [invoiceId, tenantId],
    );
    return rows;
  }

  async exportSingleInvoice(tenantId: string, id: string, res: Response): Promise<void> {
    const inv = await this.invoiceRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: IsNull() },
      relations: ['lines'],
    });
    if (!inv) throw new NotFoundException('Invoice not found');

    const safePoNumber = inv.poNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safePoNumber}.xlsx"; filename*=UTF-8''${encodeURIComponent(inv.poNumber)}.xlsx`);

    const workbook = new (ExcelJS as any).Workbook();
    const sheet = workbook.addWorksheet('تفاصيل الفاتورة');

    sheet.mergeCells('A1:G1');
    sheet.getCell('A1').value = `فاتورة: ${inv.poNumber}`;
    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1E5C3A' } };

    const infoRows = [
      ['المورد', inv.supplierName],
      ['رقم فاتورة المورد', inv.supplierInvoiceNumber ?? '—'],
      ['تاريخ الفاتورة', inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('ar-EG') : '—'],
      ['تاريخ الإنشاء', new Date(inv.createdAt).toLocaleDateString('ar-EG')],
      ['الحالة', inv.status],
      ['حالة الدفع', inv.paymentStatus],
    ];
    let rowIdx = 2;
    for (const [label, val] of infoRows) {
      sheet.getRow(rowIdx).values = ['', label, val];
      rowIdx++;
    }
    rowIdx++;

    const headerRow = sheet.getRow(rowIdx++);
    headerRow.values = ['#', 'المنتج', 'الباتش', 'الكمية', 'السعر', 'الخصم%', 'الإجمالي'];
    headerRow.font = { bold: true, color: { argb: 'FF1E5C3A' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F0E8' } };
    (headerRow as any).commit?.();

    inv.lines.forEach((line, i) => {
      sheet.getRow(rowIdx++).values = [
        i + 1,
        line.productName,
        line.batchNumber ?? '',
        line.purchaseQty,
        parseFloat(line.purchasePrice),
        parseFloat(line.discountPct),
        parseFloat(line.lineTotal),
      ];
    });

    rowIdx++;
    sheet.getRow(rowIdx).values = ['', '', '', '', '', 'الإجمالي الكلي', parseFloat(inv.grandTotal as any)];
    sheet.getRow(rowIdx).font = { bold: true };

    await workbook.xlsx.write(res);
    res.end();
  }

  async getInvoiceById(tenantId: string, id: string) {
    const inv = await this.invoiceRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: IsNull() },
      relations: ['lines'],
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  async updateInvoice(tenantId: string, id: string, dto: UpdateInvoiceDto, userId?: string) {
    const result = await this.dataSource.transaction(async (em) => {
      const invoice = await em.findOne(PurchaseInvoice, {
        where: { id, pharmacyTenantId: tenantId, deletedAt: null },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== 'draft') {
        throw new BadRequestException('Only draft invoices can be edited');
      }

      const changes = this.diffInvoice(invoice, dto, !!(dto.lines && dto.lines.length > 0));

      const lines = (dto.lines ?? []).map((l, i) => ({
        ...l,
        supplierTenantId: dto.supplierTenantId ?? l.supplierTenantId ?? null,
        sortOrder: l.sortOrder ?? i,
        taxAmount: 0,
        lineTotal: 0,
      }));

      const discountType  = dto.discountType  ?? invoice.discountType;
      const discountValue = dto.discountValue ?? invoice.discountValue;
      const settings      = await this.pharmacySettings.getSettings(tenantId);
      const vatMode       = settings.taxSettings?.vatCalculationMode ?? 'tax_on_net';
      const totals        = this.calcInvoiceTotals(lines, discountType, discountValue, vatMode);

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

      return { inv: await em.findOne(PurchaseInvoice, { where: { id }, relations: ['lines'] }), changes };
    });

    if (result.changes.length > 0) {
      await this.writeChangelog(id, tenantId, userId ?? null, 'updated', result.changes);
    }
    return result.inv;
  }

  async confirmInvoice(tenantId: string, id: string, userId: string) {
    let result: PurchaseInvoice | null;
    try {
    result = await this.dataSource.transaction(async (em) => {
      this.logger.log(`confirmInvoice tx start — id=${id}`);
      const invoice = await em.findOne(PurchaseInvoice, {
        where: { id, pharmacyTenantId: tenantId, deletedAt: null },
        relations: ['lines'],
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== 'draft') {
        throw new BadRequestException(`Cannot confirm invoice in '${invoice.status}' state`);
      }

      // Use em.update (not em.save) to avoid cascade-updating all invoice lines
      await em.update(PurchaseInvoice, { id }, { status: 'received', confirmedAt: new Date() });

      // Update inventory + record price history
      for (const line of invoice.lines) {
        this.logger.log(`confirmInvoice — upsertInventory productId=${line.productId} qty=${line.purchaseQty}`);
        await this.upsertInventoryItem(em, tenantId, line);

        this.logger.log(`confirmInvoice — saving PurchasePriceHistory productId=${line.productId}`);
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
      this.logger.log(`confirmInvoice — syncWishList for ${invoice.lines.length} products`);
      await this.syncWishListAfterReceive(em, tenantId, invoice.lines.map(l => l.productId));

      return em.findOne(PurchaseInvoice, { where: { id }, relations: ['lines'] });
    });
    await this.writeChangelog(id, tenantId, userId, 'confirmed', [
      { field: 'status', fieldLabel: 'الحالة', oldValue: 'مسودة', newValue: 'مستلمة' },
    ]);
    return result;
    } catch (err: any) {
      this.logger.error(`confirmInvoice FAILED id=${id}: ${err?.message}`, err?.stack);
      throw err;
    }
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

    const totalQty   = Number(line.purchaseQty) + Number(line.freeGoodsQty ?? 0);
    const costPrice  = Number(line.purchasePrice);
    const salePrice  = Number(line.salePrice ?? 0);

    if (existing.length > 0) {
      await em.query(
        `UPDATE inventory_items
         SET quantity = quantity + $1,
             "costPrice" = $2,
             "sellingPrice" = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE "sellingPrice" END,
             "updatedAt" = now()
         WHERE id = $4`,
        [totalQty, costPrice, salePrice, existing[0].id],
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
          costPrice,
          salePrice > 0 ? salePrice : costPrice,
          line.batchNumber ?? null,
          line.expiryDate ?? null,
        ],
      );
    }
  }

  private async syncWishListAfterReceive(em: EntityManager, tenantId: string, productIds: string[]) {
    if (!productIds.length) return;

    // Dedupe — confirmInvoice may pass the same productId across multiple
    // batches/lines.
    const uniqueIds = Array.from(new Set(productIds));

    // 1) Fetch current stock for every affected product in ONE query.
    const stockRows: Array<{ productId: string; total: string }> = await em.query(
      `SELECT "productId", COALESCE(SUM(quantity), 0) AS total
         FROM inventory_items
        WHERE "pharmacyTenantId" = $1
          AND "productId" = ANY($2::uuid[])
          AND "deletedAt" IS NULL
        GROUP BY "productId"`,
      [tenantId, uniqueIds],
    );
    const stockByProduct = new Map<string, number>();
    for (const r of stockRows) stockByProduct.set(r.productId, Number(r.total ?? 0));

    // 2) Fetch all relevant wishlist rows in ONE query.
    const wishes = await em.find(WishListItem, {
      where: { pharmacyTenantId: tenantId, productId: In(uniqueIds) },
    });
    if (wishes.length === 0) return;

    // 3) Partition into "fulfilled → delete" vs "still needed → update".
    const toDelete: WishListItem[] = [];
    const toUpdate: WishListItem[] = [];
    for (const w of wishes) {
      const stock = stockByProduct.get(w.productId) ?? 0;
      if (stock >= w.requestedQty) {
        toDelete.push(w);
      } else if (w.currentStock !== stock) {
        w.currentStock = stock;
        toUpdate.push(w);
      }
    }

    // 4) Bulk delete + bulk save in at most two more round-trips.
    if (toDelete.length) await em.remove(WishListItem, toDelete);
    if (toUpdate.length) await em.save(WishListItem, toUpdate);
  }

  async markInvoicePaid(tenantId: string, id: string, userId?: string) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'received') {
      throw new BadRequestException('Only received invoices can be marked as paid');
    }
    invoice.paymentStatus = 'paid';
    invoice.status = 'paid';
    const saved = await this.invoiceRepo.save(invoice);
    await this.writeChangelog(id, tenantId, userId ?? null, 'paid', [
      { field: 'paymentStatus', fieldLabel: 'حالة الدفع', oldValue: 'معلق', newValue: 'مدفوع' },
    ]);
    return saved;
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
    const saved = await this.invoiceRepo.save(invoice);
    await this.writeChangelog(id, tenantId, userId, 'cancelled', [
      { field: 'status', fieldLabel: 'الحالة', oldValue: 'مسودة', newValue: 'ملغاة' },
    ]);
    return saved;
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
    const [totals, wishList] = await Promise.all([
      this.dataSource.query(
        `SELECT
           -- This month: count ALL non-cancelled invoices created this month
           COUNT(*) FILTER (WHERE status != 'cancelled'
             AND DATE_TRUNC('month', "createdAt") = DATE_TRUNC('month', NOW())
           ) AS "thisMonthCount",
           -- This month value: sum of received/paid invoices created this month
           COALESCE(SUM("grandTotal") FILTER (WHERE status IN ('received','paid')
             AND DATE_TRUNC('month', "createdAt") = DATE_TRUNC('month', NOW())
           ), 0) AS "thisMonthValue",
           -- All time
           COUNT(*) FILTER (WHERE status IN ('received','paid')) AS "totalInvoices",
           COALESCE(SUM("grandTotal") FILTER (WHERE status IN ('received','paid')), 0) AS "totalSpent",
           -- Pending payment (received but not paid)
           COALESCE(SUM("grandTotal") FILTER (WHERE "paymentStatus" = 'pending' AND status IN ('received','paid')), 0) AS "totalPending",
           COUNT(*) FILTER (WHERE status = 'draft') AS "draftCount",
           COUNT(*) FILTER (WHERE "paymentStatus" = 'pending' AND status IN ('received','paid')) AS "pendingPaymentCount"
         FROM purchase_invoices
         WHERE "pharmacyTenantId" = $1 AND "deletedAt" IS NULL`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS cnt FROM wish_list_items WHERE "pharmacyTenantId" = $1`,
        [tenantId],
      ),
    ]);

    return {
      ...totals[0],
      pendingPaymentCount: Number(totals[0].pendingPaymentCount ?? 0),
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
        // Same precision + clamp guards as invoices; returns must mirror
        // invoice math so a refund never rounds against the pharmacy.
        const qty       = Math.max(0, Number(l.returnQty)    || 0);
        const price     = Math.max(0, Number(l.returnPrice)  || 0);
        const discPct   = Math.min(100, Math.max(0, Number(l.discountPct) || 0));
        const taxPct    = Math.max(0,             Number(l.taxPct)      || 0);

        const base       = this.money(qty * price);
        const discAmount = this.money(base * (discPct / 100));
        const afterDisc  = this.money(base - discAmount);
        const tax        = this.money(afterDisc * (taxPct / 100));

        l.taxAmount = tax;
        l.lineTotal = this.money(afterDisc + tax);
        subtotal   += afterDisc;
        totalTax   += tax;
      }

      const discountValueRaw = Math.max(0, Number(dto.discountValue) || 0);
      const discountType     = dto.discountType ?? 'percent';
      const discountValue    = discountType === 'percent'
        ? Math.min(100, discountValueRaw)
        : discountValueRaw;
      const totalDiscount = discountType === 'percent'
        ? this.money(subtotal * (discountValue / 100))
        : this.money(Math.min(discountValue, subtotal));

      // Mirror invoice VAT model so refund tax matches the original charge.
      const settings = await this.pharmacySettings.getSettings(tenantId);
      const vatMode  = settings.taxSettings?.vatCalculationMode ?? 'tax_on_net';
      let adjustedTax = this.money(totalTax);
      if (vatMode === 'tax_on_net' && totalDiscount > 0 && subtotal > 0) {
        const taxableAfterInvDisc = this.money(subtotal - totalDiscount);
        const effectiveTaxRate    = totalTax / subtotal;
        adjustedTax               = this.money(taxableAfterInvDisc * effectiveTaxRate);
        if (totalTax > 0) {
          const ratio = adjustedTax / totalTax;
          for (const l of lines) {
            const oldTax    = Number(l.taxAmount) || 0;
            const afterDisc = (Number(l.lineTotal) || 0) - oldTax;
            const newTax    = this.money(oldTax * ratio);
            l.taxAmount = newTax;
            l.lineTotal = this.money(afterDisc + newTax);
          }
        }
      }
      const grandTotal = this.money(subtotal - totalDiscount + adjustedTax);

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
        subtotal: this.money(subtotal),
        totalDiscount,
        totalTax: adjustedTax,
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

    // ── Skip items that already have a live draft PO (prevents accidental
    // duplicate purchases when "Create POs for all" is clicked multiple times).
    // An item is "still pending" if its draftPoId points to a non-cancelled
    // purchase_invoices row. Once the invoice is received, syncWishListAfterReceive
    // removes the wish list item entirely, so this check is sufficient.
    const eligible: WishListItem[] = [];
    const skipped: { item: WishListItem; draftPoNumber: string }[] = [];
    const draftIds = items.filter(i => i.draftPoId).map(i => i.draftPoId!) as string[];
    const liveDrafts = draftIds.length
      ? await this.invoiceRepo.find({
          where: { id: In(draftIds), pharmacyTenantId: tenantId },
          select: ['id', 'poNumber', 'status'],
        })
      : [];
    const liveDraftIds = new Set(
      liveDrafts.filter(d => d.status !== 'cancelled').map(d => d.id),
    );

    for (const item of items) {
      if (item.draftPoId && liveDraftIds.has(item.draftPoId)) {
        skipped.push({ item, draftPoNumber: item.draftPoNumber ?? '' });
      } else {
        eligible.push(item);
      }
    }

    if (!eligible.length) {
      throw new BadRequestException(
        `كل المنتجات المحددة لديها فواتير مسودة قائمة بالفعل (${skipped.length}). ` +
        `قم بمراجعة المسودات أو حذفها قبل إنشاء طلبات جديدة.`,
      );
    }

    // ── Resolve best supplier + current quoted price for any item missing
    // a `lastSupplierId`. The wish-list nightly cron only sets supplier info
    // when it can derive it from past purchases; manually-added items often
    // arrive without a supplier and would otherwise produce an empty bill
    // labelled "غير محدد". We pick the supplier with the highest reliability
    // score and lowest current price — same heuristic ProcurementDraftService
    // uses, so the two pathways stay consistent for the user.
    const missingProductIds = eligible
      .filter(i => !i.lastSupplierId)
      .map(i => i.productId);

    const priceByProductSupplier = new Map<string, number>();   // key = pid::sid
    if (missingProductIds.length) {
      const rows: Array<{ productId: string; supplierTenantId: string; supplierName: string; price: number }> =
        await this.dataSource.query(
          `SELECT DISTINCT ON (c."productId")
                  c."productId",
                  c."supplierTenantId",
                  COALESCE(t.name, 'مورد') AS "supplierName",
                  c.price::float AS price
             FROM supplier_catalog c
             LEFT JOIN tenants t ON t.id = c."supplierTenantId"
            WHERE c."productId" = ANY($1::uuid[])
              AND c."isAvailable" = true
              AND c."deletedAt" IS NULL
            ORDER BY c."productId", c.price ASC`,
          [missingProductIds],
        );
      const bestByProduct = new Map(rows.map(r => [r.productId, r]));
      const resolvedItems: WishListItem[] = [];
      for (const item of eligible) {
        if (!item.lastSupplierId) {
          const best = bestByProduct.get(item.productId);
          if (best) {
            item.lastSupplierId   = best.supplierTenantId;
            item.lastSupplierName = best.supplierName;
            priceByProductSupplier.set(`${item.productId}::${best.supplierTenantId}`, Number(best.price));
            resolvedItems.push(item);
          }
        }
      }
      // Persist enrichment in one bulk write so the UI shows real suppliers next
      // refresh (avoids one UPDATE round-trip per resolved item).
      if (resolvedItems.length) await this.wishListRepo.save(resolvedItems);
    }

    // Also fetch prices for items that already had a supplier — we want every
    // line to start with a real cost so the invoice isn't a "zero bill".
    const knownPairs = eligible
      .filter(i => i.lastSupplierId && !priceByProductSupplier.has(`${i.productId}::${i.lastSupplierId}`))
      .map(i => ({ productId: i.productId, supplierTenantId: i.lastSupplierId! }));
    if (knownPairs.length) {
      const productIds  = [...new Set(knownPairs.map(p => p.productId))];
      const supplierIds = [...new Set(knownPairs.map(p => p.supplierTenantId))];
      const priceRows: Array<{ productId: string; supplierTenantId: string; price: number }> =
        await this.dataSource.query(
          `SELECT "productId","supplierTenantId", price::float AS price
             FROM supplier_catalog
            WHERE "productId" = ANY($1::uuid[])
              AND "supplierTenantId" = ANY($2::uuid[])
              AND "isAvailable" = true
              AND "deletedAt" IS NULL`,
          [productIds, supplierIds],
        );
      for (const r of priceRows) {
        priceByProductSupplier.set(`${r.productId}::${r.supplierTenantId}`, Number(r.price));
      }
    }

    // Group eligible items by (now-resolved) supplier
    const groups = new Map<string, { supplierName: string; supplierId: string | null; items: WishListItem[] }>();
    for (const item of eligible) {
      const key = item.lastSupplierId ?? '_unknown';
      if (!groups.has(key)) {
        groups.set(key, {
          supplierName: item.lastSupplierName ?? 'مورد غير محدد',
          supplierId: item.lastSupplierId ?? null,
          items: [],
        });
      }
      groups.get(key)!.items.push(item);
    }

    const created: PurchaseInvoice[] = [];
    const taggedItems: WishListItem[] = [];
    for (const [, group] of groups) {
      const lines = group.items.map((item, i) => {
        const price = group.supplierId
          ? (priceByProductSupplier.get(`${item.productId}::${group.supplierId}`) ?? 0)
          : 0;
        return {
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku ?? null,
          purchaseQty: item.requestedQty,
          purchasePrice: price,
          sortOrder: i,
          taxAmount: 0,
          lineTotal: 0,
        };
      });

      const inv = await this.createInvoice(tenantId, {
        supplierTenantId: group.supplierId,
        supplierName: group.supplierName,
        discountType: 'percent',
        discountValue: 0,
        notes: 'تم إنشاؤها تلقائياً من قائمة الأمنيات — راجع الأسعار قبل التأكيد.',
        lines: lines as any,
      }, userId);

      // Tag wish list items with the new draft PO so subsequent clicks skip them
      for (const item of group.items) {
        item.draftPoId = inv.id;
        item.draftPoNumber = inv.poNumber;
        taggedItems.push(item);
      }

      created.push(inv);
    }
    // Bulk-persist all draft-PO tags in a single write instead of one per item.
    if (taggedItems.length) await this.wishListRepo.save(taggedItems);

    // ── Notify the pharmacy that draft purchase orders were generated, and
    // flag any items we couldn't match to a supplier so the buyer follows up
    // manually instead of silently shipping an empty "غير محدد" bill (G1+G2).
    const unresolvedCount = groups.get('_unknown')?.items.length ?? 0;
    try {
      const parts: string[] = [`تم إنشاء ${created.length} طلب شراء مسودة من قائمة الأمنيات.`];
      if (unresolvedCount > 0) {
        parts.push(`${unresolvedCount} منتج لم نتمكن من تحديد مورد له تلقائياً — افتح المسودة وأضف المورد والسعر يدوياً.`);
      }
      parts.push('راجع الأسعار والكميات ثم أكّد الطلبات.');
      await this.notificationSvc.create({
        tenantId:    tenantId,
        userId:      userId ?? undefined,
        type:        'draft_created',
        title:       unresolvedCount > 0 ? 'طلبات شراء مسودة — تحتاج مراجعة' : 'تم إنشاء طلبات شراء مسودة',
        body:        parts.join(' '),
        resourceRef: created.length === 1 ? `purchase_invoice:${created[0].id}` : undefined,
      });
    } catch (err: any) {
      this.logger.warn(`wish-list draft notification failed: ${err.message}`);
    }

    return {
      invoices: created,
      createdCount: created.length,
      skippedCount: skipped.length,
      skipped: skipped.map(s => ({
        productName: s.item.productName,
        draftPoNumber: s.draftPoNumber,
      })),
    };
  }

  // ─── Nightly wish list auto-populate (called by cron) ────────────────────────

  // ─── Excel export (streaming — handles millions of rows) ─────────────────────

  async streamInvoicesToXlsx(tenantId: string, query: InvoiceQueryDto, res: Response): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="purchases_${today}.xlsx"; filename*=UTF-8''purchases_${today}.xlsx`);

    const workbook = new (ExcelJS as any).stream.xlsx.WorkbookWriter({ stream: res });
    const sheet = workbook.addWorksheet('فواتير المشتريات');

    sheet.columns = [
      { header: 'رقم الفاتورة',        key: 'poNumber',              width: 22 },
      { header: 'المورد',              key: 'supplierName',           width: 30 },
      { header: 'رقم فاتورة المورد',   key: 'supplierInvoiceNumber',  width: 22 },
      { header: 'تاريخ الفاتورة',      key: 'invoiceDate',            width: 16 },
      { header: 'الحالة',             key: 'status',                 width: 12 },
      { header: 'حالة الدفع',         key: 'paymentStatus',          width: 12 },
      { header: 'طريقة الدفع',        key: 'paymentMethod',          width: 16 },
      { header: 'الإجمالي (ر.س)',     key: 'grandTotal',             width: 16 },
      { header: 'إجمالي الخصم (ر.س)', key: 'totalDiscount',          width: 18 },
      { header: 'تاريخ الإنشاء',      key: 'createdAt',              width: 20 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FF1E5C3A' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F0E8' } };
    (headerRow as any).commit();

    const qb = this.invoiceRepo
      .createQueryBuilder('i')
      .where('i.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('i.deletedAt IS NULL')
      .select([
        'i.poNumber', 'i.supplierName', 'i.supplierInvoiceNumber',
        'i.invoiceDate', 'i.status', 'i.paymentStatus', 'i.paymentMethod',
        'i.grandTotal', 'i.totalDiscount', 'i.createdAt',
      ]);

    if (query.q) {
      qb.andWhere('(i.poNumber ILIKE :q OR i.supplierName ILIKE :q OR i.supplierInvoiceNumber ILIKE :q)', { q: `%${query.q}%` });
    }
    if (query.status)        qb.andWhere('i.status = :status', { status: query.status });
    if (query.paymentStatus) qb.andWhere('i.paymentStatus = :ps', { ps: query.paymentStatus });
    if (query.supplierId)    qb.andWhere('i.supplierTenantId = :sid', { sid: query.supplierId });
    if (query.dateFrom)      qb.andWhere('i.createdAt >= :from', { from: query.dateFrom });
    if (query.dateTo)        qb.andWhere('i.createdAt <= :to',   { to: `${query.dateTo}T23:59:59` });

    qb.orderBy('i.createdAt', 'DESC');

    const STATUS_LABELS: Record<string, string> = {
      draft: 'مسودة', received: 'مستلمة', paid: 'مدفوعة', cancelled: 'ملغاة',
    };
    const PAYMENT_LABELS: Record<string, string> = { pending: 'معلق', paid: 'مدفوع' };
    const METHOD_LABELS: Record<string, string> = {
      cash: 'نقدي', credit_card: 'بطاقة ائتمان', bank_transfer: 'تحويل بنكي', credit_term: 'أجل',
    };
    const fmtDate = (v: any) => v ? new Date(v).toLocaleDateString('ar-EG') : '';

    const stream = await qb.stream();
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (row: any) => {
        sheet.addRow({
          poNumber:              row.i_poNumber,
          supplierName:          row.i_supplierName,
          supplierInvoiceNumber: row.i_supplierInvoiceNumber ?? '',
          invoiceDate:           fmtDate(row.i_invoiceDate),
          status:                STATUS_LABELS[row.i_status] ?? row.i_status,
          paymentStatus:         PAYMENT_LABELS[row.i_paymentStatus] ?? row.i_paymentStatus,
          paymentMethod:         METHOD_LABELS[row.i_paymentMethod] ?? row.i_paymentMethod,
          grandTotal:            parseFloat(row.i_grandTotal ?? '0'),
          totalDiscount:         parseFloat(row.i_totalDiscount ?? '0'),
          createdAt:             fmtDate(row.i_createdAt),
        }).commit();
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    await workbook.commit();
  }

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

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PriceSnapshot } from './entities/price-snapshot.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { SupplierProfile } from '../supplier/entities/supplier-profile.entity';
import { WeeklyAnalyticsSnapshot } from './entities/weekly-analytics-snapshot.entity';

export interface Paginated<T> {
  data: T[];
  total: number;
}

export interface SalesSummaryRow {
  period:               string;
  salesBeforeDiscount:  number;
  totalSales:           number;
  totalReturns:         number;
  netSales:             number;
  invoiceCount:         number;
  avgInvoice:           number;
  totalDiscounts:       number;
  totalTax:             number;
  cogs:                 number;
  grossMargin:          number;
  grossMarginPct:       number;
  // Monthly extras
  monthStart?:    string;
  monthEnd?:      string;
  year?:          number;
  monthNumber?:   number;
  // Weekly extras
  weekStart?:     string;
  weekEnd?:       string;
  weekNumber?:    number;
}

export interface ProductSalesRow {
  productCode:        string;
  productName:        string;
  category:           string;
  saleDate:           string;
  qtySold:            number;
  avgQtyPerInvoice:   number;
  invoiceCount:       number;
  totalDiscounts:     number;
  totalSales:         number;
  salesBeforeDiscount: number;
  totalReturns:       number;
  netSales:           number;
  totalTax:           number;
  cogs:               number;
  grossMargin:        number;
  grossMarginPct:     number;
  qtyReturned:        number;
  avgInvoiceValue:    number;
}

export interface CategorySalesRow {
  category:            string;
  saleDate:            string;
  qtySold:             number;
  qtyReturned:         number;
  invoiceCount:        number;
  totalDiscounts:      number;
  totalSales:          number;
  salesBeforeDiscount: number;
  totalReturns:        number;
  netSales:            number;
  cogs:                number;
  grossMargin:         number;
  grossMarginPct:      number;
}

export interface InventoryReportRow {
  productCode:      string;
  productName:      string;
  barcode:          string;
  category:         string;
  stockQty:         number;
  costValue:        number;
  sellValue:        number;
  availableForSale: number;
  nearExpiryQty:    number;
  expiredQty:       number;
  avgCostPrice:     number;
  avgSellPrice:     number;
  status:           'active' | 'near_expiry' | 'expired' | 'low_stock';
  avgDiscount:      number;
  minDiscount:      number;
  maxDiscount:      number;
  avgFreeUnits:     number;
  minFreeUnits:     number;
  maxFreeUnits:     number;
  avgProfitPerUnit: number;
}

export interface ExpiryReportRow {
  inventoryItemId: string;
  productCode:     string;
  productName:     string;
  barcode:         string;
  batchNumber:     string;
  expiryDate:      string;
  daysUntilExpiry: number;
  quantity:        number;
  costPrice:       number;
  sellingPrice:    number;
  costValue:       number;
  category:        string;
}

export interface InsuranceClaimsRow {
  invoiceDate:            string;
  insuranceCompany:       string;
  insuranceCompanyId:     string;
  patientCount:           number;
  invoiceCount:           number;
  totalSales:             number;
  insuranceCoveredAmount: number;
  patientDueAmount:       number;
  reimbursementAmount:    number;
  pendingAmount:          number;
}

export interface DemandSignal {
  productId:       string;
  productName:     string;
  category:        string;
  severity:        'critical' | 'high' | 'medium';
  affectedCount:   number;   // # of pharmacies with this shortage (never identifies which)
  regionCount:     number;   // # of distinct regions with this shortage
}

export interface PricePoint {
  date:              string;
  price:             number;
  currency:          string;
  stockAtTime:       number | null;
}

export interface RegionalPrice {
  supplierTenantId:  string;
  region:            string;
  latestPrice:       number;
  currency:          string;
  priceChange30d:    number | null;  // % change vs 30 days ago
}

@Injectable()
export class AnalyticsReadService {
  private readonly logger = new Logger(AnalyticsReadService.name);

  constructor(
    @InjectRepository(PriceSnapshot)
    private readonly priceSnapshotRepo: Repository<PriceSnapshot>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(SupplierProfile)
    private readonly profileRepo: Repository<SupplierProfile>,
    @InjectRepository(WeeklyAnalyticsSnapshot)
    private readonly snapshotRepo: Repository<WeeklyAnalyticsSnapshot>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Demand Signals (for suppliers) ──────────────────────────────────────

  /**
   * Returns anonymized, aggregated shortage signals for a supplier's delivery zones.
   * Shows WHAT is running low and WHERE (region level), never which specific pharmacy.
   */
  async getDemandSignalsForSupplier(
    supplierTenantId: string,
    deliveryZones: string[],
  ): Promise<DemandSignal[]> {
    if (!deliveryZones.length) return [];

    // Get pharmacies in the supplier's delivery zones
    const pharmacies = await this.tenantRepo
      .createQueryBuilder('t')
      .where("t.type = 'pharmacy'")
      .andWhere('t.isActive = true')
      .andWhere('t.region IN (:...zones)', { zones: deliveryZones })
      .getMany();

    if (!pharmacies.length) return [];

    const pharmacyIds = pharmacies.map((p) => p.id);
    const regionMap   = new Map(pharmacies.map((p) => [p.id, p.region]));

    // Find low-stock items across those pharmacies
    const lowStock: Array<{
      productId:   string;
      productName: string;
      category:    string;
      tenantId:    string;
      deficit:     number;
    }> = await this.dataSource.query(
      `
      SELECT
        i."productId",
        p.name        AS "productName",
        p.category,
        i."pharmacyTenantId" AS "tenantId",
        (i."minThreshold" - i.quantity) AS deficit
      FROM inventory_items i
      JOIN products p ON p.id = i."productId"
      WHERE i."pharmacyTenantId" = ANY($1)
        AND i."deletedAt" IS NULL
        AND i.quantity <= i."minThreshold"
      `,
      [pharmacyIds],
    );

    if (!lowStock.length) return [];

    // Aggregate by product — count affected pharmacies and regions
    const productMap = new Map<string, {
      productName: string;
      category:    string;
      tenantIds:   Set<string>;
      regions:     Set<string>;
      maxDeficit:  number;
    }>();

    for (const row of lowStock) {
      if (!productMap.has(row.productId)) {
        productMap.set(row.productId, {
          productName: row.productName,
          category:    row.category,
          tenantIds:   new Set(),
          regions:     new Set(),
          maxDeficit:  0,
        });
      }
      const entry = productMap.get(row.productId);
      entry.tenantIds.add(row.tenantId);
      entry.regions.add(regionMap.get(row.tenantId) ?? 'unknown');
      entry.maxDeficit = Math.max(entry.maxDeficit, row.deficit);
    }

    const signals: DemandSignal[] = Array.from(productMap.entries()).map(([productId, data]) => ({
      productId,
      productName:  data.productName,
      category:     data.category,
      severity:     data.tenantIds.size >= 5 ? 'critical' : data.tenantIds.size >= 2 ? 'high' : 'medium',
      affectedCount: data.tenantIds.size,
      regionCount:   data.regions.size,
    }));

    return signals.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2 };
      return order[a.severity] - order[b.severity];
    });
  }

  // ─── Pricing Analytics ────────────────────────────────────────────────────

  /** Price trend for a specific product from a specific supplier */
  async getPriceTrend(
    supplierTenantId: string,
    productId: string,
    days = 90,
  ): Promise<PricePoint[]> {
    const since = new Date(Date.now() - days * 86_400_000);
    const snapshots = await this.priceSnapshotRepo
      .createQueryBuilder('s')
      .where('s.supplierTenantId = :supplierTenantId', { supplierTenantId })
      .andWhere('s.productId = :productId', { productId })
      .andWhere('s.recordedAt >= :since', { since })
      .orderBy('s.recordedAt', 'ASC')
      .getMany();

    return snapshots.map((s) => ({
      date:        s.recordedAt.toISOString().split('T')[0],
      price:       Number(s.price),
      currency:    s.currency,
      stockAtTime: s.stockAtTime ?? null,
    }));
  }

  /** Current prices for a product across all suppliers, enriched with region and 30-day change */
  async getRegionalPricing(productId: string): Promise<RegionalPrice[]> {
    // Latest price per supplier
    const latest: Array<{ supplierTenantId: string; price: string; currency: string; recordedAt: Date }> =
      await this.dataSource.query(
        `
        SELECT DISTINCT ON (s."supplierTenantId")
          s."supplierTenantId",
          s.price,
          s.currency,
          s."recordedAt"
        FROM price_snapshots s
        WHERE s."productId" = $1
        ORDER BY s."supplierTenantId", s."recordedAt" DESC
        `,
        [productId],
      );

    if (!latest.length) return [];

    const supplierIds = latest.map((r) => r.supplierTenantId);

    // 30-day-ago prices
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const old: Array<{ supplierTenantId: string; price: string }> = await this.dataSource.query(
      `
      SELECT DISTINCT ON (s."supplierTenantId")
        s."supplierTenantId",
        s.price
      FROM price_snapshots s
      WHERE s."productId" = $1
        AND s."supplierTenantId" = ANY($2)
        AND s."recordedAt" <= $3
      ORDER BY s."supplierTenantId", s."recordedAt" DESC
      `,
      [productId, supplierIds, thirtyDaysAgo],
    );
    const oldMap = new Map(old.map((r) => [r.supplierTenantId, parseFloat(r.price)]));

    // Supplier regions from profiles
    const profiles = await this.profileRepo.find({
      where: supplierIds.map((id) => ({ supplierTenantId: id })),
    });
    const regionMap = new Map(
      profiles.flatMap((p) => p.deliveryZones.map((zone) => [p.supplierTenantId, zone])),
    );

    return latest.map((r) => {
      const latestPrice = parseFloat(r.price);
      const oldPrice    = oldMap.get(r.supplierTenantId);
      const change      = oldPrice ? Math.round(((latestPrice - oldPrice) / oldPrice) * 100) : null;

      return {
        supplierTenantId: r.supplierTenantId,
        region:           regionMap.get(r.supplierTenantId) ?? 'unknown',
        latestPrice,
        currency:         r.currency,
        priceChange30d:   change,
      };
    });
  }

  // ─── Sales Summary Report ─────────────────────────────────────────────────

  async getSalesSummary(
    tenantId: string,
    params: {
      granularity: 'daily' | 'weekly' | 'monthly';
      dateFrom: string;
      dateTo: string;
      cashierName?: string;
      hideZeroRows?: boolean;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<SalesSummaryRow>> {
    const { granularity, dateFrom, dateTo, cashierName, hideZeroRows = false } = params;

    let trunc: string, fmt: string;
    switch (granularity) {
      case 'monthly': trunc = 'month'; fmt = 'YYYY-MM';       break;
      case 'weekly':  trunc = 'week';  fmt = 'IYYY-"W"IW';    break;
      default:        trunc = 'day';   fmt = 'YYYY-MM-DD';
    }

    const dateToExclusive = new Date(dateTo);
    dateToExclusive.setDate(dateToExclusive.getDate() + 1);
    const dateToStr = dateToExclusive.toISOString().split('T')[0];

    const page     = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 50));
    const offset   = (page - 1) * pageSize;

    const bindings: any[] = [tenantId, dateFrom, dateToStr];
    let cashierFilter = '';
    if (cashierName?.trim()) {
      bindings.push(`%${cashierName.trim()}%`);
      cashierFilter = `AND EXISTS (
          SELECT 1 FROM pos_shifts s
          WHERE s.id = "shiftId"
            AND COALESCE(s."cashierName", '') ILIKE $${bindings.length}
        )`;
    }

    const havingClause = hideZeroRows
      ? `HAVING SUM(CASE WHEN type = 'sale' THEN "totalAmount" ELSE 0 END) > 0`
      : '';

    bindings.push(pageSize, offset);
    const limitIdx  = bindings.length - 1;
    const offsetIdx = bindings.length;

    const rows: any[] = await this.dataSource.query(`
      WITH filtered_tx AS (
        SELECT
          id, type, subtotal, "discountAmount", "taxAmount", "totalAmount",
          DATE_TRUNC('${trunc}', "createdAt") AS period
        FROM pos_transactions
        WHERE "pharmacyTenantId" = $1
          AND status = 'completed'
          AND "createdAt" >= $2::date
          AND "createdAt" < $3::date
          ${cashierFilter}
      ),
      tx_cogs AS (
        SELECT
          ti."transactionId",
          SUM(ti.quantity * COALESCE(i."costPrice", 0)) AS cogs
        FROM pos_transaction_items ti
        JOIN filtered_tx f ON f.id = ti."transactionId"
        LEFT JOIN inventory_items i ON i.id = ti."inventoryItemId"
        GROUP BY ti."transactionId"
      ),
      period_data AS (
        SELECT f.period, f.type, f.subtotal, f."discountAmount", f."taxAmount",
               f."totalAmount", COALESCE(c.cogs, 0) AS cogs
        FROM filtered_tx f
        LEFT JOIN tx_cogs c ON c."transactionId" = f.id
      ),
      summary AS (
        SELECT
          TO_CHAR(period, '${fmt}') AS period,
          ROUND(SUM(CASE WHEN type = 'sale' THEN subtotal + "discountAmount" ELSE 0 END)::numeric, 2) AS "salesBeforeDiscount",
          ROUND(SUM(CASE WHEN type = 'sale' THEN "totalAmount" ELSE 0 END)::numeric, 2) AS "totalSales",
          ROUND(SUM(CASE WHEN type = 'return' THEN "totalAmount" ELSE 0 END)::numeric, 2) AS "totalReturns",
          ROUND((SUM(CASE WHEN type = 'sale' THEN "totalAmount" ELSE 0 END) - SUM(CASE WHEN type = 'return' THEN "totalAmount" ELSE 0 END))::numeric, 2) AS "netSales",
          COUNT(CASE WHEN type = 'sale' THEN 1 END)::int AS "invoiceCount",
          ROUND(COALESCE(AVG(CASE WHEN type = 'sale' THEN "totalAmount" END), 0)::numeric, 2) AS "avgInvoice",
          ROUND(SUM(CASE WHEN type = 'sale' THEN "discountAmount" ELSE 0 END)::numeric, 2) AS "totalDiscounts",
          ROUND(SUM(CASE WHEN type = 'sale' THEN "taxAmount" ELSE 0 END)::numeric, 2) AS "totalTax",
          ROUND(SUM(CASE WHEN type = 'sale' THEN cogs ELSE 0 END)::numeric, 2) AS "cogs",
          ROUND((SUM(CASE WHEN type = 'sale' THEN "totalAmount" ELSE 0 END) - SUM(CASE WHEN type = 'sale' THEN cogs ELSE 0 END))::numeric, 2) AS "grossMargin"
        FROM period_data
        GROUP BY period
        ${havingClause}
      )
      SELECT COUNT(*) OVER() AS _total, summary.*
      FROM summary
      ORDER BY summary.period
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, bindings);

    const total = rows.length > 0 ? Number(rows[0]._total) : 0;

    const data = rows.map(r => {
      const netSales    = Number(r.netSales);
      const grossMargin = Number(r.grossMargin);
      const base: SalesSummaryRow = {
        period:               r.period,
        salesBeforeDiscount:  Number(r.salesBeforeDiscount),
        totalSales:           Number(r.totalSales),
        totalReturns:         Number(r.totalReturns),
        netSales,
        invoiceCount:         Number(r.invoiceCount),
        avgInvoice:           Number(r.avgInvoice),
        totalDiscounts:       Number(r.totalDiscounts),
        totalTax:             Number(r.totalTax),
        cogs:                 Number(r.cogs),
        grossMargin,
        grossMarginPct:       netSales > 0 ? Math.round((grossMargin / netSales) * 1000) / 10 : 0,
      };
      if (granularity === 'monthly') {
        const [y, m] = r.period.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        base.year        = y;
        base.monthNumber = m;
        base.monthStart  = `${r.period}-01`;
        base.monthEnd    = `${r.period}-${String(lastDay).padStart(2, '0')}`;
      } else if (granularity === 'weekly') {
        const [isoYear, weekPart] = r.period.split('-W');
        const wn = parseInt(weekPart, 10);
        const yr = parseInt(isoYear, 10);
        const jan4 = new Date(yr, 0, 4);
        const startOfW1 = new Date(jan4);
        startOfW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
        const weekStart = new Date(startOfW1);
        weekStart.setDate(startOfW1.getDate() + (wn - 1) * 7);
        const weekEnd   = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        base.year       = yr;
        base.weekNumber = wn;
        base.weekStart  = weekStart.toISOString().split('T')[0];
        base.weekEnd    = weekEnd.toISOString().split('T')[0];
      }
      return base;
    });

    return { data, total };
  }

  // ─── Sales by Product ─────────────────────────────────────────────────────

  async getSalesByProduct(
    tenantId: string,
    params: {
      dateFrom: string;
      dateTo: string;
      search?: string;
      category?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<ProductSalesRow>> {
    const { dateFrom, dateTo, search, category } = params;

    const dateToExclusive = new Date(dateTo);
    dateToExclusive.setDate(dateToExclusive.getDate() + 1);
    const dateToStr = dateToExclusive.toISOString().split('T')[0];

    const page     = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 50));
    const offset   = (page - 1) * pageSize;

    const bindings: any[] = [tenantId, dateFrom, dateToStr];
    let extraWhere = '';

    if (category) {
      bindings.push(category);
      extraWhere += ` AND p.category = $${bindings.length}`;
    }
    if (search) {
      bindings.push(`%${search}%`);
      extraWhere += ` AND (COALESCE(p.sku, '') ILIKE $${bindings.length} OR COALESCE(p.name, '') ILIKE $${bindings.length} OR ti."productName" ILIKE $${bindings.length})`;
    }

    bindings.push(pageSize, offset);
    const limitIdx  = bindings.length - 1;
    const offsetIdx = bindings.length;

    try {
      const rows: any[] = await this.dataSource.query(`
        WITH base AS (
          SELECT
            COALESCE(p.sku, '')                               AS "productCode",
            COALESCE(p.name, ti."productName", '')            AS "productName",
            COALESCE(p.category, '')                          AS "category",
            TO_CHAR(DATE(tx."createdAt"), 'YYYY-MM-DD')       AS "saleDate",
            SUM(CASE WHEN tx.type = 'sale' THEN ti.quantity ELSE 0 END)::int AS "qtySold",
            ROUND(
              SUM(CASE WHEN tx.type = 'sale' THEN ti.quantity ELSE 0 END)::numeric /
              NULLIF(COUNT(DISTINCT CASE WHEN tx.type = 'sale' THEN tx.id END), 0),
              4
            )                                                 AS "avgQtyPerInvoice",
            COUNT(DISTINCT CASE WHEN tx.type = 'sale' THEN tx.id END)::int AS "invoiceCount",
            ROUND(SUM(CASE WHEN tx.type = 'sale' THEN ti."discountAmount" ELSE 0 END)::numeric, 2) AS "totalDiscounts",
            ROUND(SUM(CASE WHEN tx.type = 'sale' THEN ti.subtotal ELSE 0 END)::numeric, 2) AS "totalSales",
            ROUND(SUM(CASE WHEN tx.type = 'sale' THEN (ti."unitPrice" * ti.quantity) ELSE 0 END)::numeric, 2) AS "salesBeforeDiscount",
            ROUND(SUM(CASE WHEN tx.type = 'return' THEN ti.subtotal ELSE 0 END)::numeric, 2) AS "totalReturns",
            SUM(CASE WHEN tx.type = 'return' THEN ti.quantity ELSE 0 END)::int AS "qtyReturned",
            ROUND((SUM(CASE WHEN tx.type = 'sale' THEN ti.subtotal ELSE 0 END) -
                   SUM(CASE WHEN tx.type = 'return' THEN ti.subtotal ELSE 0 END))::numeric, 2) AS "netSales",
            ROUND(SUM(CASE WHEN tx.type = 'sale' THEN ti.quantity * COALESCE(inv."costPrice", 0) ELSE 0 END)::numeric, 2) AS "cogs",
            ROUND((SUM(CASE WHEN tx.type = 'sale' THEN ti.subtotal ELSE 0 END) -
                   SUM(CASE WHEN tx.type = 'sale' THEN ti.quantity * COALESCE(inv."costPrice", 0) ELSE 0 END))::numeric, 2) AS "grossMargin"
          FROM pos_transaction_items ti
          JOIN pos_transactions tx      ON tx.id  = ti."transactionId"
          LEFT JOIN products p          ON p.id   = ti."productId"
          LEFT JOIN inventory_items inv ON inv.id = ti."inventoryItemId"
          WHERE tx."pharmacyTenantId" = $1
            AND tx.status = 'completed'
            AND tx."createdAt" >= $2::date
            AND tx."createdAt" < $3::date
            ${extraWhere}
          GROUP BY ti."productId", ti."productName", p.id, p.sku, p.name, p.category, DATE(tx."createdAt")
        )
        SELECT COUNT(*) OVER() AS _total, base.*
        FROM base
        ORDER BY base."saleDate" DESC, base."netSales" DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `, bindings);

      const total = rows.length > 0 ? Number(rows[0]._total) : 0;
      const data = rows.map(r => ({
        productCode:         r.productCode        ?? '',
        productName:         r.productName        ?? '',
        category:            r.category           ?? '',
        saleDate:            r.saleDate,
        qtySold:             Number(r.qtySold),
        avgQtyPerInvoice:    Number(r.avgQtyPerInvoice),
        invoiceCount:        Number(r.invoiceCount),
        totalDiscounts:      Number(r.totalDiscounts),
        totalSales:          Number(r.totalSales),
        salesBeforeDiscount: Number(r.salesBeforeDiscount),
        totalReturns:        Number(r.totalReturns),
        netSales:            Number(r.netSales),
        totalTax:            0,
        cogs:                Number(r.cogs),
        grossMargin:         Number(r.grossMargin),
        grossMarginPct:      Number(r.netSales) > 0
          ? Math.round((Number(r.grossMargin) / Number(r.netSales)) * 1000) / 10
          : 0,
        qtyReturned:         Number(r.qtyReturned),
        avgInvoiceValue:     Number(r.invoiceCount) > 0
          ? Math.round((Number(r.netSales) / Number(r.invoiceCount)) * 100) / 100
          : 0,
      }));

      return { data, total };
    } catch (err) {
      this.logger.error(
        `getSalesByProduct FAILED — tenant=${tenantId} dateFrom=${dateFrom} dateTo=${dateTo}`,
        err?.message,
        err?.stack,
      );
      throw err;
    }
  }

  // ─── Sales-by-Product Diagnostic ─────────────────────────────────────────

  async diagSalesByProduct(tenantId: string): Promise<any> {
    const [txCount] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM pos_transactions WHERE "pharmacyTenantId" = $1 AND status = 'completed'`,
      [tenantId],
    );
    const [tiCount] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM pos_transaction_items ti
       JOIN pos_transactions tx ON tx.id = ti."transactionId"
       WHERE tx."pharmacyTenantId" = $1`,
      [tenantId],
    );
    const [matchedProducts] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM pos_transaction_items ti
       JOIN pos_transactions tx ON tx.id = ti."transactionId"
       JOIN products p ON p.id = ti."productId"
       WHERE tx."pharmacyTenantId" = $1`,
      [tenantId],
    );
    const [dateRange] = await this.dataSource.query(
      `SELECT MIN("createdAt") AS oldest, MAX("createdAt") AS newest
       FROM pos_transactions WHERE "pharmacyTenantId" = $1 AND status = 'completed'`,
      [tenantId],
    );
    return { txCount: txCount.total, tiCount: tiCount.total, matchedProducts: matchedProducts.total, dateRange };
  }

  // ─── Sales-by-Category Report ─────────────────────────────────────────────

  async getSalesByCategory(
    tenantId: string,
    params: {
      dateFrom: string;
      dateTo: string;
      category?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<CategorySalesRow>> {
    const { dateFrom, dateTo, category } = params;

    const dateToExclusive = new Date(dateTo);
    dateToExclusive.setDate(dateToExclusive.getDate() + 1);
    const dateToStr = dateToExclusive.toISOString().split('T')[0];

    const page     = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 50));
    const offset   = (page - 1) * pageSize;

    const bindings: any[] = [tenantId, dateFrom, dateToStr];
    let extraWhere = '';

    if (category) {
      bindings.push(category);
      extraWhere += ` AND COALESCE(p.category, '') = $${bindings.length}`;
    }

    bindings.push(pageSize, offset);
    const limitIdx  = bindings.length - 1;
    const offsetIdx = bindings.length;

    try {
      const rows: any[] = await this.dataSource.query(`
        WITH base AS (
          SELECT
            COALESCE(p.category, 'بدون فئة')                         AS "category",
            TO_CHAR(DATE(tx."createdAt"), 'YYYY-MM-DD')               AS "saleDate",
            SUM(CASE WHEN tx.type = 'sale'   THEN ti.quantity ELSE 0 END)::int AS "qtySold",
            SUM(CASE WHEN tx.type = 'return' THEN ti.quantity ELSE 0 END)::int AS "qtyReturned",
            COUNT(DISTINCT CASE WHEN tx.type = 'sale' THEN tx.id END)::int     AS "invoiceCount",
            ROUND(SUM(CASE WHEN tx.type = 'sale' THEN ti."discountAmount" ELSE 0 END)::numeric, 2) AS "totalDiscounts",
            ROUND(SUM(CASE WHEN tx.type = 'sale' THEN ti.subtotal ELSE 0 END)::numeric, 2) AS "totalSales",
            ROUND(SUM(CASE WHEN tx.type = 'sale' THEN (ti."unitPrice" * ti.quantity) ELSE 0 END)::numeric, 2) AS "salesBeforeDiscount",
            ROUND(SUM(CASE WHEN tx.type = 'return' THEN ti.subtotal ELSE 0 END)::numeric, 2) AS "totalReturns",
            ROUND((SUM(CASE WHEN tx.type = 'sale'   THEN ti.subtotal ELSE 0 END) -
                   SUM(CASE WHEN tx.type = 'return' THEN ti.subtotal ELSE 0 END))::numeric, 2) AS "netSales",
            ROUND(SUM(CASE WHEN tx.type = 'sale' THEN ti.quantity * COALESCE(inv."costPrice", 0) ELSE 0 END)::numeric, 2) AS "cogs",
            ROUND((SUM(CASE WHEN tx.type = 'sale' THEN ti.subtotal ELSE 0 END) -
                   SUM(CASE WHEN tx.type = 'sale' THEN ti.quantity * COALESCE(inv."costPrice", 0) ELSE 0 END))::numeric, 2) AS "grossMargin"
          FROM pos_transaction_items ti
          JOIN pos_transactions tx      ON tx.id  = ti."transactionId"
          LEFT JOIN products p          ON p.id   = ti."productId"
          LEFT JOIN inventory_items inv ON inv.id = ti."inventoryItemId"
          WHERE tx."pharmacyTenantId" = $1
            AND tx.status = 'completed'
            AND tx."createdAt" >= $2::date
            AND tx."createdAt" < $3::date
            ${extraWhere}
          GROUP BY COALESCE(p.category, 'بدون فئة'), DATE(tx."createdAt")
        )
        SELECT COUNT(*) OVER() AS _total, base.*
        FROM base
        ORDER BY base."saleDate" DESC, base."netSales" DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `, bindings);

      const total = rows.length > 0 ? Number(rows[0]._total) : 0;
      const data = rows.map(r => ({
        category:            r.category            ?? '',
        saleDate:            r.saleDate,
        qtySold:             Number(r.qtySold),
        qtyReturned:         Number(r.qtyReturned),
        invoiceCount:        Number(r.invoiceCount),
        totalDiscounts:      Number(r.totalDiscounts),
        totalSales:          Number(r.totalSales),
        salesBeforeDiscount: Number(r.salesBeforeDiscount),
        totalReturns:        Number(r.totalReturns),
        netSales:            Number(r.netSales),
        cogs:                Number(r.cogs),
        grossMargin:         Number(r.grossMargin),
        grossMarginPct:      Number(r.netSales) > 0
          ? Math.round((Number(r.grossMargin) / Number(r.netSales)) * 1000) / 10
          : 0,
      }));

      return { data, total };
    } catch (err) {
      this.logger.error(
        `getSalesByCategory FAILED — tenant=${tenantId} dateFrom=${dateFrom} dateTo=${dateTo}`,
        err?.message,
        err?.stack,
      );
      throw err;
    }
  }

  // ─── Pharmacy Dashboard Analytics ─────────────────────────────────────────

  async getWeeklySnapshots(tenantId: string, weeks = 12): Promise<WeeklyAnalyticsSnapshot[]> {
    return this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId })
      .orderBy('s.weekStart', 'DESC')
      .take(weeks)
      .getMany();
  }

  // ─── Current Inventory Report ─────────────────────────────────────────────

  async getInventoryReport(
    tenantId: string,
    params: { search?: string; category?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<Paginated<InventoryReportRow>> {
    const { search, category, status } = params;

    const page     = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(5000, Math.max(1, params.pageSize ?? 50));
    const offset   = (page - 1) * pageSize;

    const bindings: any[] = [tenantId];
    let extraWhere = '';

    if (category) {
      bindings.push(category);
      extraWhere += ` AND p.category = $${bindings.length}`;
    }
    if (search) {
      bindings.push(`%${search}%`);
      extraWhere += ` AND (COALESCE(p.sku, '') ILIKE $${bindings.length} OR COALESCE(p.name, '') ILIKE $${bindings.length} OR COALESCE(p.barcode, '') ILIKE $${bindings.length})`;
    }

    let statusWhere = '';
    if (status === 'expired') {
      statusWhere = `WHERE computed_status = 'expired'`;
    } else if (status === 'near_expiry') {
      statusWhere = `WHERE computed_status = 'near_expiry'`;
    } else if (status === 'low_stock') {
      statusWhere = `WHERE computed_status = 'low_stock'`;
    } else if (status === 'active') {
      statusWhere = `WHERE computed_status = 'active'`;
    }

    bindings.push(pageSize, offset);
    const limitIdx  = bindings.length - 1;
    const offsetIdx = bindings.length;

    const rows: any[] = await this.dataSource.query(`
      WITH discount_stats AS (
        SELECT
          ti."productId",
          AVG(CASE WHEN ti."unitPrice" * ti.quantity > 0
            THEN (ti."discountAmount" / (ti."unitPrice" * ti.quantity)) * 100
            ELSE 0 END)                                    AS "avgDiscount",
          MIN(CASE WHEN ti."unitPrice" * ti.quantity > 0
            THEN (ti."discountAmount" / (ti."unitPrice" * ti.quantity)) * 100
            ELSE 0 END)                                    AS "minDiscount",
          MAX(CASE WHEN ti."unitPrice" * ti.quantity > 0
            THEN (ti."discountAmount" / (ti."unitPrice" * ti.quantity)) * 100
            ELSE 0 END)                                    AS "maxDiscount"
        FROM pos_transaction_items ti
        JOIN pos_transactions tx ON tx.id = ti."transactionId"
        WHERE tx."pharmacyTenantId" = $1
          AND tx.status  = 'completed'
          AND tx.type    = 'sale'
          AND tx."createdAt" >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY ti."productId"
      ),
      inventory_base AS (
        SELECT
          COALESCE(p.sku, '')      AS "productCode",
          COALESCE(p.name, '')     AS "productName",
          COALESCE(p.barcode, '')  AS "barcode",
          COALESCE(p.category, '') AS "category",
          SUM(i.quantity)::int     AS "stockQty",
          ROUND(SUM(i.quantity * COALESCE(i."costPrice",    0))::numeric, 2) AS "costValue",
          ROUND(SUM(i.quantity * COALESCE(i."sellingPrice", 0))::numeric, 2) AS "sellValue",
          SUM(CASE WHEN i."expiryDate" IS NULL OR i."expiryDate" > CURRENT_DATE + 90 THEN i.quantity ELSE 0 END)::int AS "availableForSale",
          SUM(CASE WHEN i."expiryDate" IS NOT NULL AND i."expiryDate" > CURRENT_DATE AND i."expiryDate" <= CURRENT_DATE + 90 THEN i.quantity ELSE 0 END)::int AS "nearExpiryQty",
          SUM(CASE WHEN i."expiryDate" IS NOT NULL AND i."expiryDate" <= CURRENT_DATE THEN i.quantity ELSE 0 END)::int AS "expiredQty",
          ROUND(AVG(COALESCE(i."costPrice",    0))::numeric, 2) AS "avgCostPrice",
          ROUND(AVG(COALESCE(i."sellingPrice", 0))::numeric, 2) AS "avgSellPrice",
          CASE
            WHEN SUM(CASE WHEN i."expiryDate" IS NOT NULL AND i."expiryDate" <= CURRENT_DATE THEN 1 ELSE 0 END) > 0 THEN 'expired'
            WHEN SUM(CASE WHEN i."expiryDate" IS NOT NULL AND i."expiryDate" > CURRENT_DATE AND i."expiryDate" <= CURRENT_DATE + 90 THEN 1 ELSE 0 END) > 0 THEN 'near_expiry'
            WHEN SUM(i.quantity) <= MIN(i."minThreshold") THEN 'low_stock'
            ELSE 'active'
          END AS computed_status,
          ROUND(COALESCE(MAX(d."avgDiscount"), 0)::numeric, 2) AS "avgDiscount",
          ROUND(COALESCE(MAX(d."minDiscount"), 0)::numeric, 2) AS "minDiscount",
          ROUND(COALESCE(MAX(d."maxDiscount"), 0)::numeric, 2) AS "maxDiscount",
          ROUND(AVG(COALESCE(i."sellingPrice", 0) - COALESCE(i."costPrice", 0))::numeric, 2) AS "avgProfitPerUnit",
          SUM(i.quantity * COALESCE(i."sellingPrice", 0)) AS _sort_val
        FROM inventory_items i
        LEFT JOIN products p       ON p.id = i."productId"
        LEFT JOIN discount_stats d ON d."productId" = i."productId"
        WHERE i."pharmacyTenantId" = $1
          AND i."deletedAt" IS NULL
          ${extraWhere}
        GROUP BY i."productId", p.id, p.sku, p.name, p.barcode, p.category
      )
      SELECT COUNT(*) OVER() AS _total, inventory_base.*
      FROM inventory_base
      ${statusWhere}
      ORDER BY _sort_val DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, bindings);

    const total = rows.length > 0 ? Number(rows[0]._total) : 0;
    const data: InventoryReportRow[] = rows.map(r => ({
      productCode:      r.productCode,
      productName:      r.productName,
      barcode:          r.barcode,
      category:         r.category,
      stockQty:         Number(r.stockQty),
      costValue:        Number(r.costValue),
      sellValue:        Number(r.sellValue),
      availableForSale: Number(r.availableForSale),
      nearExpiryQty:    Number(r.nearExpiryQty),
      expiredQty:       Number(r.expiredQty),
      avgCostPrice:     Number(r.avgCostPrice),
      avgSellPrice:     Number(r.avgSellPrice),
      status:           r.computed_status as InventoryReportRow['status'],
      avgDiscount:      Number(r.avgDiscount),
      minDiscount:      Number(r.minDiscount),
      maxDiscount:      Number(r.maxDiscount),
      avgFreeUnits:     0,
      minFreeUnits:     0,
      maxFreeUnits:     0,
      avgProfitPerUnit: Number(r.avgProfitPerUnit),
    }));

    return { data, total };
  }

  // ─── Expiry Report ────────────────────────────────────────────────────────

  async getExpiryReport(
    tenantId: string,
    params: { search?: string; category?: string; status?: string; daysAhead?: number; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number },
  ): Promise<Paginated<ExpiryReportRow>> {
    const { search, category, status, daysAhead, dateFrom, dateTo } = params;

    const page     = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 50));
    const offset   = (page - 1) * pageSize;

    const bindings: any[] = [tenantId];
    let extraWhere = '';

    if (category) {
      bindings.push(category);
      extraWhere += ` AND COALESCE(p.category, '') = $${bindings.length}`;
    }
    if (search) {
      bindings.push(`%${search}%`);
      extraWhere += ` AND (COALESCE(p.sku, '') ILIKE $${bindings.length} OR COALESCE(p.name, '') ILIKE $${bindings.length} OR COALESCE(p.barcode, '') ILIKE $${bindings.length} OR COALESCE(i."batchNumber", '') ILIKE $${bindings.length})`;
    }
    if (dateFrom) {
      bindings.push(dateFrom);
      extraWhere += ` AND i."expiryDate" >= $${bindings.length}::date`;
    }
    if (dateTo) {
      bindings.push(dateTo);
      extraWhere += ` AND i."expiryDate" <= $${bindings.length}::date`;
    }
    if (!dateFrom && !dateTo && daysAhead !== undefined && daysAhead >= 0) {
      bindings.push(daysAhead);
      extraWhere += ` AND i."expiryDate" <= CURRENT_DATE + ($${bindings.length} || ' days')::interval`;
    }
    if (status === 'expired') {
      extraWhere += ` AND i."expiryDate" <= CURRENT_DATE`;
    } else if (status === 'near_expiry') {
      extraWhere += ` AND i."expiryDate" > CURRENT_DATE AND i."expiryDate" <= CURRENT_DATE + INTERVAL '90 days'`;
    } else if (status === 'active') {
      extraWhere += ` AND (i."expiryDate" IS NULL OR i."expiryDate" > CURRENT_DATE + INTERVAL '90 days')`;
    }

    bindings.push(pageSize, offset);
    const limitIdx  = bindings.length - 1;
    const offsetIdx = bindings.length;

    const rows: any[] = await this.dataSource.query(`
      WITH base AS (
        SELECT
          i.id                                             AS "inventoryItemId",
          COALESCE(p.sku, '')                              AS "productCode",
          COALESCE(p.name, '')                             AS "productName",
          COALESCE(p.barcode, '')                          AS "barcode",
          COALESCE(i."batchNumber", '')                    AS "batchNumber",
          TO_CHAR(i."expiryDate", 'YYYY-MM-DD')            AS "expiryDate",
          (i."expiryDate"::date - CURRENT_DATE)::int       AS "daysUntilExpiry",
          i.quantity                                       AS "quantity",
          ROUND(COALESCE(i."costPrice",    0)::numeric, 4) AS "costPrice",
          ROUND(COALESCE(i."sellingPrice", 0)::numeric, 4) AS "sellingPrice",
          ROUND((i.quantity * COALESCE(i."costPrice", 0))::numeric, 2) AS "costValue",
          COALESCE(p.category, '')                         AS "category"
        FROM inventory_items i
        LEFT JOIN products p ON p.id = i."productId"
        WHERE i."pharmacyTenantId" = $1
          AND i."deletedAt" IS NULL
          AND i."expiryDate" IS NOT NULL
          ${extraWhere}
      )
      SELECT COUNT(*) OVER() AS _total, base.*
      FROM base
      ORDER BY base."expiryDate" ASC, base.quantity DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, bindings);

    const total = rows.length > 0 ? Number(rows[0]._total) : 0;
    const data = rows.map(r => ({
      inventoryItemId: r.inventoryItemId,
      productCode:     r.productCode,
      productName:     r.productName,
      barcode:         r.barcode,
      batchNumber:     r.batchNumber,
      expiryDate:      r.expiryDate ?? '',
      daysUntilExpiry: Number(r.daysUntilExpiry ?? 0),
      quantity:        Number(r.quantity),
      costPrice:       Number(r.costPrice),
      sellingPrice:    Number(r.sellingPrice),
      costValue:       Number(r.costValue),
      category:        r.category,
    }));

    return { data, total };
  }

  // ─── Data Diagnostic ─────────────────────────────────────────────────────

  async getDataDiag(tenantId: string): Promise<any> {
    const run = (sql: string, p: any[] = []) => this.dataSource.query(sql, p).then((r: any[]) => r[0]);

    const [tx, ti, inv, invExpiry, cust, txRange] = await Promise.all([
      run(`SELECT COUNT(*)::int AS count FROM pos_transactions WHERE "pharmacyTenantId" = $1 AND status = 'completed'`, [tenantId]),
      run(`SELECT COUNT(*)::int AS count FROM pos_transaction_items ti JOIN pos_transactions tx ON tx.id = ti."transactionId" WHERE tx."pharmacyTenantId" = $1`, [tenantId]),
      run(`SELECT COUNT(*)::int AS count FROM inventory_items WHERE "pharmacyTenantId" = $1 AND "deletedAt" IS NULL`, [tenantId]),
      run(`SELECT COUNT(*)::int AS count FROM inventory_items WHERE "pharmacyTenantId" = $1 AND "deletedAt" IS NULL AND "expiryDate" IS NOT NULL`, [tenantId]),
      run(`SELECT COUNT(*)::int AS count FROM pos_customers WHERE "pharmacyTenantId" = $1 AND "insuranceCompanyId" IS NOT NULL AND "deletedAt" IS NULL`, [tenantId]),
      run(`SELECT MIN("createdAt")::date AS oldest, MAX("createdAt")::date AS newest FROM pos_transactions WHERE "pharmacyTenantId" = $1 AND status = 'completed'`, [tenantId]),
    ]);

    return {
      tenantId,
      completedTransactions: tx.count,
      transactionItems: ti.count,
      inventoryItems: inv.count,
      inventoryItemsWithExpiry: invExpiry.count,
      customersWithInsurance: cust.count,
      transactionDateRange: { oldest: txRange.oldest, newest: txRange.newest },
    };
  }

  // ─── Insurance Claims Report ──────────────────────────────────────────────

  async getInsuranceClaimsReport(
    tenantId: string,
    params: { dateFrom?: string; dateTo?: string; insuranceCompanyId?: string; page?: number; pageSize?: number },
  ): Promise<Paginated<InsuranceClaimsRow>> {
    const { dateFrom, dateTo, insuranceCompanyId } = params;

    const page     = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 50));
    const offset   = (page - 1) * pageSize;

    const bindings: any[] = [tenantId];
    let extraWhere = '';

    if (dateFrom) {
      bindings.push(dateFrom);
      extraWhere += ` AND tx."createdAt"::date >= $${bindings.length}::date`;
    }
    if (dateTo) {
      bindings.push(dateTo);
      extraWhere += ` AND tx."createdAt"::date <= $${bindings.length}::date`;
    }
    if (insuranceCompanyId) {
      bindings.push(insuranceCompanyId);
      extraWhere += ` AND ic.id = $${bindings.length}`;
    }

    bindings.push(pageSize, offset);
    const limitIdx  = bindings.length - 1;
    const offsetIdx = bindings.length;

    const rows: any[] = await this.dataSource.query(`
      WITH base AS (
        SELECT
          TO_CHAR(tx."createdAt"::date, 'YYYY-MM-DD')                    AS "invoiceDate",
          ic.name                                                          AS "insuranceCompany",
          ic.id                                                            AS "insuranceCompanyId",
          COUNT(DISTINCT tx."customerId")::int                            AS "patientCount",
          COUNT(DISTINCT tx.id)::int                                      AS "invoiceCount",
          ROUND(SUM(tx."totalAmount")::numeric, 2)                        AS "totalSales",
          ROUND(SUM(tx."totalAmount" * (1 - COALESCE(c."copayPercent", ic."patientPercent", 20.0) / 100.0))::numeric, 2) AS "insuranceCoveredAmount",
          ROUND(SUM(tx."totalAmount" * (COALESCE(c."copayPercent", ic."patientPercent", 20.0) / 100.0))::numeric, 2) AS "patientDueAmount",
          ROUND(SUM(tx."totalAmount" * (1 - COALESCE(c."copayPercent", ic."patientPercent", 20.0) / 100.0))::numeric, 2) AS "reimbursementAmount",
          ROUND(SUM(tx."totalAmount" * (1 - COALESCE(c."copayPercent", ic."patientPercent", 20.0) / 100.0))::numeric, 2) AS "pendingAmount"
        FROM pos_transactions tx
        JOIN pos_customers c
          ON c.id = tx."customerId"
          AND c."pharmacyTenantId" = $1
          AND c."deletedAt" IS NULL
          AND c."insuranceCompanyId" IS NOT NULL
        JOIN insurance_companies ic
          ON ic.id = c."insuranceCompanyId"
          AND ic."pharmacyTenantId" = $1
        WHERE tx."pharmacyTenantId" = $1
          AND tx.status = 'completed'
          AND tx.type   = 'sale'
          AND tx."customerId" IS NOT NULL
          ${extraWhere}
        GROUP BY tx."createdAt"::date, ic.id, ic.name
      )
      SELECT COUNT(*) OVER() AS _total, base.*
      FROM base
      ORDER BY base."invoiceDate" DESC, base."insuranceCompany" ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, bindings);

    const total = rows.length > 0 ? Number(rows[0]._total) : 0;
    const data = rows.map(r => ({
      invoiceDate:            r.invoiceDate ?? '',
      insuranceCompany:       r.insuranceCompany ?? '',
      insuranceCompanyId:     r.insuranceCompanyId,
      patientCount:           Number(r.patientCount),
      invoiceCount:           Number(r.invoiceCount),
      totalSales:             Number(r.totalSales),
      insuranceCoveredAmount: Number(r.insuranceCoveredAmount),
      patientDueAmount:       Number(r.patientDueAmount),
      reimbursementAmount:    Number(r.reimbursementAmount),
      pendingAmount:          Number(r.pendingAmount),
    }));

    return { data, total };
  }
}

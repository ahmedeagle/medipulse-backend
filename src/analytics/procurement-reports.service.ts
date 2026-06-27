import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Cross-channel procurement, supplier-performance and P2P reports.
 *
 * Channels covered (anything the pharmacy buys / inbounds):
 *   • purchase_invoices  — pharmacy-side recorded invoices (the canonical spend ledger)
 *   • orders             — supplier POs in the network (when delivered)
 *   • p2p_orders         — peer-to-peer purchases from other pharmacies
 *
 * Every query is tenant-scoped via parameter binding to prevent leakage.
 */

export interface RangeParams { dateFrom: string; dateTo: string; }

@Injectable()
export class ProcurementReportsService {
  private readonly logger = new Logger(ProcurementReportsService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Report A — Procurement Spend (cross-channel)
  // ────────────────────────────────────────────────────────────────────────────
  async getProcurementSummary(
    tenantId: string,
    p: RangeParams & { channel?: 'all'|'invoices'|'orders'|'p2p'; supplierId?: string },
  ) {
    const { dateFrom, dateTo, channel = 'all', supplierId } = p;

    const wantInv = channel === 'all' || channel === 'invoices';
    const wantOrd = channel === 'all' || channel === 'orders';
    const wantP2p = channel === 'all' || channel === 'p2p';

    // ── Totals per channel
    const [invTotal] = wantInv ? await this.ds.query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM("grandTotal"),0)::float AS total
         FROM purchase_invoices
        WHERE "pharmacyTenantId" = $1
          AND "deletedAt" IS NULL
          AND status IN ('received','paid')
          AND ("invoiceDate" >= $2::date OR ("invoiceDate" IS NULL AND "createdAt" >= $2::date))
          AND ("invoiceDate" <= $3::date OR ("invoiceDate" IS NULL AND "createdAt" <= ($3::date + INTERVAL '1 day')))
          ${supplierId ? `AND "supplierTenantId" = $4` : ''}`,
      supplierId ? [tenantId, dateFrom, dateTo, supplierId] : [tenantId, dateFrom, dateTo],
    ) : [{ cnt: 0, total: 0 }];

    const [ordTotal] = wantOrd ? await this.ds.query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM("totalAmount"),0)::float AS total
         FROM orders
        WHERE "pharmacyTenantId" = $1
          AND status IN ('delivered','partially_delivered','received_pending_qc')
          AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
          ${supplierId ? `AND "supplierTenantId" = $4` : ''}`,
      supplierId ? [tenantId, dateFrom, dateTo, supplierId] : [tenantId, dateFrom, dateTo],
    ) : [{ cnt: 0, total: 0 }];

    const [p2pTotal] = wantP2p ? await this.ds.query(
      `SELECT COUNT(*)::int AS cnt,
              COALESCE(SUM("agreedPrice" * "requestedQty"),0)::float AS total
         FROM p2p_orders
        WHERE "buyerTenantId" = $1
          AND status IN ('completed','shipped','accepted')
          AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')`,
      [tenantId, dateFrom, dateTo],
    ) : [{ cnt: 0, total: 0 }];

    const totalSpend = Number(invTotal.total) + Number(ordTotal.total) + Number(p2pTotal.total);
    const totalCount = Number(invTotal.cnt) + Number(ordTotal.cnt) + Number(p2pTotal.cnt);

    // ── Monthly trend, unioned across channels
    const trend = await this.ds.query(
      `WITH inv AS (
         SELECT date_trunc('month', COALESCE("invoiceDate","createdAt"::date))::date AS m,
                COALESCE(SUM("grandTotal"),0)::float AS total,
                'invoices'::text AS channel
           FROM purchase_invoices
          WHERE "pharmacyTenantId" = $1 AND "deletedAt" IS NULL
            AND status IN ('received','paid')
            AND COALESCE("invoiceDate","createdAt"::date) BETWEEN $2::date AND $3::date
          GROUP BY 1
       ), ord AS (
         SELECT date_trunc('month', "createdAt")::date AS m,
                COALESCE(SUM("totalAmount"),0)::float AS total,
                'orders'::text AS channel
           FROM orders
          WHERE "pharmacyTenantId" = $1
            AND status IN ('delivered','partially_delivered','received_pending_qc')
            AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
          GROUP BY 1
       ), p2p AS (
         SELECT date_trunc('month', "createdAt")::date AS m,
                COALESCE(SUM("agreedPrice" * "requestedQty"),0)::float AS total,
                'p2p'::text AS channel
           FROM p2p_orders
          WHERE "buyerTenantId" = $1
            AND status IN ('completed','shipped','accepted')
            AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
          GROUP BY 1
       )
       SELECT m::text AS month, channel, total
         FROM (SELECT * FROM inv UNION ALL SELECT * FROM ord UNION ALL SELECT * FROM p2p) u
        ORDER BY m ASC`,
      [tenantId, dateFrom, dateTo],
    );

    // ── Top suppliers (invoices + orders only; P2P is peers not suppliers)
    const topSuppliers = await this.ds.query(
      `WITH a AS (
         SELECT "supplierTenantId" AS sid, "supplierName" AS name,
                COALESCE(SUM("grandTotal"),0)::float AS total,
                COUNT(*)::int AS cnt
           FROM purchase_invoices
          WHERE "pharmacyTenantId" = $1 AND "deletedAt" IS NULL
            AND status IN ('received','paid')
            AND COALESCE("invoiceDate","createdAt"::date) BETWEEN $2::date AND $3::date
          GROUP BY "supplierTenantId","supplierName"
       ), b AS (
         SELECT o."supplierTenantId" AS sid,
                COALESCE(t.name, 'مورد') AS name,
                COALESCE(SUM(o."totalAmount"),0)::float AS total,
                COUNT(*)::int AS cnt
           FROM orders o
           LEFT JOIN tenants t ON t.id = o."supplierTenantId"
          WHERE o."pharmacyTenantId" = $1
            AND o.status IN ('delivered','partially_delivered','received_pending_qc')
            AND o."createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
          GROUP BY o."supplierTenantId", t.name
       ), u AS (SELECT * FROM a UNION ALL SELECT * FROM b)
       SELECT sid::text AS "supplierId",
              MAX(name) AS "supplierName",
              SUM(total)::float AS "totalSpend",
              SUM(cnt)::int AS "orderCount"
         FROM u
        WHERE sid IS NOT NULL
        GROUP BY sid
        ORDER BY "totalSpend" DESC
        LIMIT 10`,
      [tenantId, dateFrom, dateTo],
    );

    // ── P2P estimated savings: agreedPrice vs last supplier price for same product
    const [p2pSavingsRow] = await this.ds.query(
      `WITH p AS (
         SELECT po."listingId", po."agreedPrice", po."requestedQty",
                l."productId"
           FROM p2p_orders po
           JOIN p2p_listings l ON l.id = po."listingId"
          WHERE po."buyerTenantId" = $1
            AND po.status IN ('completed','shipped','accepted')
            AND po."createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
       ), s AS (
         SELECT pil."productId",
                AVG(pil."purchasePrice")::float AS "avgSupplierPrice"
           FROM purchase_invoice_lines pil
           JOIN purchase_invoices pi ON pi.id = pil."invoiceId"
          WHERE pi."pharmacyTenantId" = $1
            AND pi."deletedAt" IS NULL
            AND pi.status IN ('received','paid')
            AND pil."purchasePrice" > 0
          GROUP BY pil."productId"
       )
       SELECT COALESCE(SUM(GREATEST(0, (s."avgSupplierPrice" - p."agreedPrice") * p."requestedQty")), 0)::float AS savings,
              COUNT(*)::int AS "p2pLines"
         FROM p
         LEFT JOIN s ON s."productId" = p."productId"`,
      [tenantId, dateFrom, dateTo],
    );

    return {
      totals: {
        totalSpend,
        totalCount,
        avgOrderValue: totalCount ? totalSpend / totalCount : 0,
        byChannel: {
          invoices: { total: Number(invTotal.total), count: Number(invTotal.cnt) },
          orders:   { total: Number(ordTotal.total), count: Number(ordTotal.cnt) },
          p2p:      { total: Number(p2pTotal.total), count: Number(p2pTotal.cnt) },
        },
        p2pSavings: Number(p2pSavingsRow?.savings ?? 0),
      },
      trend,        // [{ month, channel, total }]
      topSuppliers, // [{ supplierId, supplierName, totalSpend, orderCount }]
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Report B — Supplier Performance
  // ────────────────────────────────────────────────────────────────────────────
  async getSupplierPerformance(
    tenantId: string,
    p: RangeParams & { page?: number; pageSize?: number; search?: string },
  ) {
    const { dateFrom, dateTo, search } = p;
    const page = Math.max(1, p.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, p.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    const params: any[] = [tenantId, dateFrom, dateTo];
    let searchClause = '';
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      searchClause = `AND LOWER(COALESCE(t.name, agg."supplierName", '')) LIKE $${params.length}`;
    }

    // Aggregate per supplier from orders (canonical PO lifecycle) and invoices
    const rows = await this.ds.query(
      `WITH ord AS (
         SELECT "supplierTenantId" AS sid,
                COUNT(*)::int AS po_count,
                COALESCE(SUM("totalAmount"),0)::float AS po_spend,
                COUNT(*) FILTER (WHERE status IN ('delivered','partially_delivered','received_pending_qc'))::int AS delivered_count,
                COUNT(*) FILTER (WHERE status IN ('rejected','cancelled'))::int AS rejected_count,
                COUNT(*) FILTER (WHERE status = 'disputed')::int AS disputed_count,
                AVG(
                  CASE WHEN "deliveryTimestamp" IS NOT NULL
                       THEN EXTRACT(EPOCH FROM ("deliveryTimestamp" - "createdAt")) / 86400.0
                  END
                )::float AS avg_lead_days,
                MAX("createdAt") AS last_order_at
           FROM orders
          WHERE "pharmacyTenantId" = $1
            AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
          GROUP BY "supplierTenantId"
       ), inv AS (
         SELECT "supplierTenantId" AS sid,
                MAX("supplierName") AS "supplierName",
                COUNT(*)::int AS inv_count,
                COALESCE(SUM("grandTotal"),0)::float AS inv_spend,
                COUNT(*) FILTER (WHERE "paymentStatus" = 'paid')::int AS paid_count
           FROM purchase_invoices
          WHERE "pharmacyTenantId" = $1
            AND "deletedAt" IS NULL
            AND COALESCE("invoiceDate","createdAt"::date) BETWEEN $2::date AND $3::date
            AND status IN ('received','paid')
          GROUP BY "supplierTenantId"
       ), agg AS (
         SELECT COALESCE(ord.sid, inv.sid) AS sid,
                inv."supplierName",
                COALESCE(ord.po_count,0)         AS po_count,
                COALESCE(ord.po_spend,0)::float  AS po_spend,
                COALESCE(ord.delivered_count,0)  AS delivered_count,
                COALESCE(ord.rejected_count,0)   AS rejected_count,
                COALESCE(ord.disputed_count,0)   AS disputed_count,
                ord.avg_lead_days,
                ord.last_order_at,
                COALESCE(inv.inv_count,0)        AS inv_count,
                COALESCE(inv.inv_spend,0)::float AS inv_spend,
                COALESCE(inv.paid_count,0)       AS paid_count
           FROM ord FULL OUTER JOIN inv ON ord.sid = inv.sid
       )
       SELECT agg.sid::text AS "supplierId",
              COALESCE(t.name, agg."supplierName", 'مورد غير معروف') AS "supplierName",
              agg.po_count          AS "poCount",
              agg.po_spend          AS "poSpend",
              agg.inv_count         AS "invoiceCount",
              agg.inv_spend         AS "invoiceSpend",
              (agg.po_spend + agg.inv_spend) AS "totalSpend",
              agg.delivered_count   AS "deliveredCount",
              agg.rejected_count    AS "rejectedCount",
              agg.disputed_count    AS "disputedCount",
              CASE WHEN agg.po_count > 0
                   THEN (agg.delivered_count::float / agg.po_count) * 100
                   ELSE NULL END    AS "fillRatePct",
              CASE WHEN agg.po_count > 0
                   THEN (agg.rejected_count::float / agg.po_count) * 100
                   ELSE NULL END    AS "rejectionRatePct",
              agg.avg_lead_days     AS "avgLeadDays",
              CASE WHEN agg.inv_count > 0
                   THEN (agg.paid_count::float / agg.inv_count) * 100
                   ELSE NULL END    AS "paidRatePct",
              agg.last_order_at     AS "lastOrderAt"
         FROM agg
         LEFT JOIN tenants t ON t.id = agg.sid
        WHERE agg.sid IS NOT NULL ${searchClause}
        ORDER BY (agg.po_spend + agg.inv_spend) DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );

    const [totRow] = await this.ds.query(
      `WITH ord AS (
         SELECT DISTINCT "supplierTenantId" AS sid FROM orders
          WHERE "pharmacyTenantId" = $1
            AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
       ), inv AS (
         SELECT DISTINCT "supplierTenantId" AS sid FROM purchase_invoices
          WHERE "pharmacyTenantId" = $1 AND "deletedAt" IS NULL
            AND status IN ('received','paid')
            AND COALESCE("invoiceDate","createdAt"::date) BETWEEN $2::date AND $3::date
       )
       SELECT COUNT(DISTINCT sid)::int AS total
         FROM (SELECT sid FROM ord UNION SELECT sid FROM inv) u
        WHERE sid IS NOT NULL`,
      [tenantId, dateFrom, dateTo],
    );

    return { data: rows, total: Number(totRow?.total ?? 0), page, pageSize };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Report C — P2P Activity (buyer + seller)
  // ────────────────────────────────────────────────────────────────────────────
  async getP2pActivity(tenantId: string, p: RangeParams) {
    const { dateFrom, dateTo } = p;

    const [buyer] = await this.ds.query(
      `SELECT COUNT(*)::int AS "totalOrders",
              COUNT(*) FILTER (WHERE status='completed')::int AS "completedOrders",
              COUNT(*) FILTER (WHERE status='cancelled')::int AS "cancelledOrders",
              COUNT(*) FILTER (WHERE status='rejected')::int  AS "rejectedOrders",
              COUNT(DISTINCT "sellerTenantId")::int AS "uniquePeers",
              COALESCE(SUM("agreedPrice" * "requestedQty"),0)::float AS "totalSpend",
              COALESCE(SUM("agreedPrice" * "requestedQty") FILTER (WHERE status IN ('completed','shipped','accepted')),0)::float AS "settledSpend"
         FROM p2p_orders
        WHERE "buyerTenantId" = $1
          AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')`,
      [tenantId, dateFrom, dateTo],
    );

    const [seller] = await this.ds.query(
      `SELECT COUNT(*)::int AS "totalOrders",
              COUNT(*) FILTER (WHERE status='completed')::int AS "completedOrders",
              COUNT(DISTINCT "buyerTenantId")::int AS "uniquePeers",
              COALESCE(SUM("agreedPrice" * "requestedQty"),0)::float AS "totalRevenue",
              COALESCE(SUM("agreedPrice" * "requestedQty") FILTER (WHERE status IN ('completed','shipped','accepted')),0)::float AS "settledRevenue"
         FROM p2p_orders
        WHERE "sellerTenantId" = $1
          AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')`,
      [tenantId, dateFrom, dateTo],
    );

    // Daily trend
    const trend = await this.ds.query(
      `SELECT date_trunc('day', "createdAt")::date::text AS day,
              COUNT(*) FILTER (WHERE "buyerTenantId" = $1)::int  AS "buyOrders",
              COUNT(*) FILTER (WHERE "sellerTenantId" = $1)::int AS "sellOrders",
              COALESCE(SUM("agreedPrice" * "requestedQty") FILTER (WHERE "buyerTenantId" = $1),0)::float  AS "buyValue",
              COALESCE(SUM("agreedPrice" * "requestedQty") FILTER (WHERE "sellerTenantId" = $1),0)::float AS "sellValue"
         FROM p2p_orders
        WHERE ("buyerTenantId" = $1 OR "sellerTenantId" = $1)
          AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
        GROUP BY 1 ORDER BY 1 ASC`,
      [tenantId, dateFrom, dateTo],
    );

    // Top peers (combined buy + sell counts/value)
    const topPeers = await this.ds.query(
      `WITH u AS (
         SELECT "sellerTenantId" AS peer, "agreedPrice" * "requestedQty" AS val, 'buy' AS dir
           FROM p2p_orders
          WHERE "buyerTenantId" = $1
            AND status IN ('completed','shipped','accepted')
            AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
         UNION ALL
         SELECT "buyerTenantId" AS peer, "agreedPrice" * "requestedQty" AS val, 'sell' AS dir
           FROM p2p_orders
          WHERE "sellerTenantId" = $1
            AND status IN ('completed','shipped','accepted')
            AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')
       )
       SELECT u.peer::text AS "peerId",
              COALESCE(t.name, 'صيدلية شريكة') AS "peerName",
              COUNT(*)::int AS "tradeCount",
              COALESCE(SUM(val),0)::float AS "tradeValue",
              SUM(CASE WHEN dir='buy'  THEN 1 ELSE 0 END)::int AS "asBuyer",
              SUM(CASE WHEN dir='sell' THEN 1 ELSE 0 END)::int AS "asSeller"
         FROM u LEFT JOIN tenants t ON t.id = u.peer
        GROUP BY u.peer, t.name
        ORDER BY "tradeValue" DESC
        LIMIT 10`,
      [tenantId, dateFrom, dateTo],
    );

    // Active listings count snapshot
    const [listings] = await this.ds.query(
      `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'sold_out')::int AS sold
         FROM p2p_listings
        WHERE "sellerTenantId" = $1
          AND "createdAt" BETWEEN $2::date AND ($3::date + INTERVAL '1 day')`,
      [tenantId, dateFrom, dateTo],
    ).catch(() => [{ total: 0, active: 0, sold: 0 }]);

    return {
      buyer,
      seller,
      netPosition: Number(seller?.totalRevenue ?? 0) - Number(buyer?.totalSpend ?? 0),
      trend,
      topPeers,
      listings,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface ProcurementOpportunity {
  inventoryItemId: string;
  productId: string;
  productName: string | null;
  productNameAr: string | null;
  barcode: string | null;
  sku: string | null;
  currentQty: number;
  minThreshold: number;
  /** null when source is supplier-only (no P2P listing available) */
  p2pListingId: string | null;
  p2pPrice: number | null;
  bestSupplierPrice: number | null;
  savingsPct: number | null;
  sellerTenantId: string | null;
  sellerName: string | null;
  sellerCity: string | null;
  distanceKm: number | null;
  listingType: string | null;
  availableQty: number | null;
  /** 'p2p' = buy from marketplace, 'supplier' = order from existing supplier */
  sourceType: 'p2p' | 'supplier';
}

@Injectable()
export class P2pSmartProcurementService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns two types of opportunities merged and ranked:
   * 1. P2P opportunities — items where a marketplace listing is ≥5% cheaper than supplier
   * 2. Supplier opportunities — items below threshold with a supplier price but no P2P listing
   *    (cold-start fallback so the section is never empty just because no P2P pharmacy registered yet)
   */
  async getOpportunities(
    pharmacyTenantId: string,
    buyerGps?: string,
    limit = 20,
    /** Minimum savings % a P2P listing must beat the supplier price by. Default 5. */
    minSavingsPct = 5,
  ): Promise<ProcurementOpportunity[]> {
    const multiplier = parseFloat((1 - Math.max(0, Math.min(minSavingsPct, 100)) / 100).toFixed(4));

    let buyerLat: number | null = null;
    let buyerLng: number | null = null;
    if (buyerGps) {
      const [a, b] = buyerGps.split(',');
      const lat = parseFloat(a);
      const lng = parseFloat(b);
      if (isFinite(lat) && isFinite(lng)) { buyerLat = lat; buyerLng = lng; }
    }

    const distanceExpr = buyerLat !== null
      ? `6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
            cos(radians(${buyerLat})) * cos(radians(split_part(sp."gpsLocation",',',1)::float))
            * cos(radians(split_part(sp."gpsLocation",',',2)::float) - radians(${buyerLng}))
            + sin(radians(${buyerLat})) * sin(radians(split_part(sp."gpsLocation",',',1)::float))
          ))`
      : 'NULL::float';

    // ── Part 1: P2P opportunities (marketplace cheaper than supplier) ─────────
    const p2pRows = await this.dataSource.query<any[]>(`
      SELECT
        inv.id                       AS "inventoryItemId",
        inv."productId",
        p."name"                     AS "productName",
        p."nameAr"                   AS "productNameAr",
        p."barcode"                  AS "barcode",
        p."sku"                      AS "sku",
        inv.quantity                 AS "currentQty",
        inv."minThreshold",
        best_p2p.listing_id          AS "p2pListingId",
        best_p2p.price               AS "p2pPrice",
        best_p2p.listing_type        AS "listingType",
        best_p2p.available_qty       AS "availableQty",
        best_p2p.seller_tenant_id    AS "sellerTenantId",
        sp2."legalName"              AS "sellerName",
        sp2.city                     AS "sellerCity",
        CASE WHEN sp2."gpsLocation" IS NOT NULL THEN
          ${distanceExpr}
        END                          AS "distanceKm",
        min_supplier.price           AS "bestSupplierPrice",
        CASE
          WHEN min_supplier.price IS NOT NULL AND min_supplier.price > 0
          THEN ROUND(((min_supplier.price - best_p2p.price) / min_supplier.price * 100)::numeric, 1)
          ELSE NULL
        END                          AS "savingsPct"
      FROM inventory_items inv
      LEFT JOIN products p ON p.id = inv."productId"
      INNER JOIN LATERAL (
        SELECT
          l.id          AS listing_id,
          l.price,
          l."listingType" AS listing_type,
          l.quantity    AS available_qty,
          l."sellerTenantId" AS seller_tenant_id
        FROM p2p_listings l
        INNER JOIN seller_profiles sp_inner
          ON sp_inner."pharmacyTenantId" = l."sellerTenantId"
          AND sp_inner."verificationStatus" = 'verified'
          AND sp_inner."isVisible" = true
        WHERE l."productId" = inv."productId"
          AND l.status = 'active'
          AND l.quantity > 0
          AND l."sellerTenantId" != $1
          AND NOT EXISTS (
            SELECT 1 FROM p2p_orders ord
            WHERE ord."listingId" = l.id
              AND ord."buyerTenantId" = $1
              AND ord.status IN ('pending', 'accepted')
          )
        ORDER BY l.price ASC
        LIMIT 1
      ) best_p2p ON true
      LEFT JOIN seller_profiles sp2
        ON sp2."pharmacyTenantId" = best_p2p.seller_tenant_id
      LEFT JOIN LATERAL (
        SELECT MIN(sci.price) AS price
        FROM supplier_catalog sci
        WHERE sci."productId" = inv."productId"
          AND sci."isAvailable" = true
          AND sci."deletedAt" IS NULL
      ) min_supplier ON true
      WHERE inv."pharmacyTenantId" = $1
        AND inv.quantity <= inv."minThreshold"
        AND inv."deletedAt" IS NULL
        AND (min_supplier.price IS NULL OR best_p2p.price < min_supplier.price * $3)
      ORDER BY
        CASE WHEN min_supplier.price IS NOT NULL
          THEN (min_supplier.price - best_p2p.price) / min_supplier.price
          ELSE 0
        END DESC,
        inv.quantity ASC
      LIMIT $2
    `, [pharmacyTenantId, limit, multiplier]);

    // ── Part 2: Supplier-only opportunities (no P2P listing exists yet) ───────
    const supplierRows = p2pRows.length < limit
      ? await this.dataSource.query<any[]>(`
          SELECT
            inv.id                 AS "inventoryItemId",
            inv."productId",
            p."name"               AS "productName",
            p."nameAr"             AS "productNameAr",
            inv.quantity           AS "currentQty",
            inv."minThreshold",
            NULL                   AS "p2pListingId",
            NULL::float            AS "p2pPrice",
            NULL                   AS "listingType",
            p."barcode"            AS "barcode",
            p."sku"                AS "sku",
            NULL::int              AS "availableQty",
            NULL                   AS "sellerTenantId",
            NULL                   AS "sellerName",
            NULL                   AS "sellerCity",
            NULL::float            AS "distanceKm",
            min_supplier.price     AS "bestSupplierPrice",
            NULL::float            AS "savingsPct"
          FROM inventory_items inv
          LEFT JOIN products p ON p.id = inv."productId"
          INNER JOIN LATERAL (
            SELECT MIN(sci.price) AS price
            FROM supplier_catalog sci
            WHERE sci."productId" = inv."productId"
              AND sci."isAvailable" = true
              AND sci."deletedAt" IS NULL
          ) min_supplier ON min_supplier.price IS NOT NULL
          -- Exclude products already covered by Part 1 (P2P cheaper than supplier).
          -- Products with P2P listings that are MORE expensive than supplier still
          -- appear here so the user gets a supplier recommendation.
          WHERE inv."pharmacyTenantId" = $1
            AND inv.quantity <= inv."minThreshold"
            AND inv."deletedAt" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM p2p_listings l
              INNER JOIN seller_profiles sp_excl
                ON sp_excl."pharmacyTenantId" = l."sellerTenantId"
                AND sp_excl."verificationStatus" = 'verified'
                AND sp_excl."isVisible" = true
              WHERE l."productId" = inv."productId"
                AND l.status = 'active'
                AND l.quantity > 0
                AND l."sellerTenantId" != $1
                AND (min_supplier.price IS NULL OR l.price < min_supplier.price * $3)
            )
          ORDER BY inv.quantity ASC
          LIMIT $2
        `, [pharmacyTenantId, limit - p2pRows.length, multiplier])
      : [];

    const toOpportunity = (r: any, sourceType: 'p2p' | 'supplier'): ProcurementOpportunity => ({
      inventoryItemId:   r.inventoryItemId,
      productId:         r.productId,
      productName:       r.productName ?? null,
      productNameAr:     r.productNameAr ?? null,
      barcode:           r.barcode ?? null,
      sku:               r.sku ?? null,
      currentQty:        Number(r.currentQty),
      minThreshold:      Number(r.minThreshold),
      p2pListingId:      r.p2pListingId ?? null,
      p2pPrice:          r.p2pPrice != null ? Number(r.p2pPrice) : null,
      bestSupplierPrice: r.bestSupplierPrice != null ? Number(r.bestSupplierPrice) : null,
      savingsPct:        r.savingsPct != null ? Number(r.savingsPct) : null,
      sellerTenantId:    r.sellerTenantId ?? null,
      sellerName:        r.sellerName ?? null,
      sellerCity:        r.sellerCity ?? null,
      distanceKm:        r.distanceKm != null ? Number(r.distanceKm) : null,
      listingType:       r.listingType ?? null,
      availableQty:      r.availableQty != null ? Number(r.availableQty) : null,
      sourceType,
    });

    return [
      ...p2pRows.map((r) => toOpportunity(r, 'p2p')),
      ...supplierRows.map((r) => toOpportunity(r, 'supplier')),
    ];
  }
}

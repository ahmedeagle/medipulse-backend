import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface MarketIntelligence {
  activeSellersCount: number;
  activeListingsCount: number;
  avgPricesByProduct: Array<{
    productId: string;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    listingsCount: number;
  }>;
  topTradedProducts: Array<{
    productId: string;
    productName: string | null;
    productNameAr: string | null;
    orderCount: number;
    totalVolume: number;
  }>;
  cityDensity: Array<{ city: string; sellerCount: number }>;
  generatedAt: string;
}

@Injectable()
export class P2pMarketIntelligenceService {
  constructor(private readonly dataSource: DataSource) {}

  async getIntelligence(
    pharmacyTenantId: string,
    city?: string,
  ): Promise<MarketIntelligence> {
    // Run all aggregate queries in parallel — each is a single SQL scan
    const [
      [summary],
      avgPrices,
      topProducts,
      cityDensity,
    ] = await Promise.all([
      // Summary counts
      this.dataSource.query<Array<{ sellers: string; listings: string }>>(`
        SELECT
          COUNT(DISTINCT l."sellerTenantId")::text AS sellers,
          COUNT(*)::text                           AS listings
        FROM p2p_listings l
        INNER JOIN seller_profiles sp
          ON sp."pharmacyTenantId" = l."sellerTenantId"
          AND sp."verificationStatus" = 'verified'
          AND sp."isVisible" = true
          ${city ? `AND sp.city ILIKE $2` : ''}
        WHERE l.status = 'active'
          AND l.quantity > 0
          AND l."sellerTenantId" != $1
      `, city ? [pharmacyTenantId, `%${city}%`] : [pharmacyTenantId]),

      // Average/min/max prices by product (top 20 by listing count)
      this.dataSource.query<any[]>(`
        SELECT
          l."productId",
          ROUND(AVG(l.price)::numeric, 2)  AS "avgPrice",
          MIN(l.price)                      AS "minPrice",
          MAX(l.price)                      AS "maxPrice",
          COUNT(*)::int                     AS "listingsCount"
        FROM p2p_listings l
        INNER JOIN seller_profiles sp
          ON sp."pharmacyTenantId" = l."sellerTenantId"
          AND sp."verificationStatus" = 'verified'
          AND sp."isVisible" = true
          ${city ? `AND sp.city ILIKE $2` : ''}
        WHERE l.status = 'active'
          AND l.quantity > 0
          AND l."sellerTenantId" != $1
        GROUP BY l."productId"
        ORDER BY COUNT(*) DESC
        LIMIT 20
      `, city ? [pharmacyTenantId, `%${city}%`] : [pharmacyTenantId]),

      // Top traded products by order count (last 30 days) — joined with product names
      this.dataSource.query<any[]>(`
        SELECT
          l."productId",
          p."name"   AS "productName",
          p."nameAr" AS "productNameAr",
          COUNT(o.id)::int           AS "orderCount",
          SUM(o."requestedQty")::int AS "totalVolume"
        FROM p2p_orders o
        INNER JOIN p2p_listings l ON l.id = o."listingId"
        LEFT  JOIN products p     ON p.id = l."productId"
        WHERE o.status IN ('accepted', 'completed')
          AND o."createdAt" >= now() - INTERVAL '30 days'
          AND o."buyerTenantId" != $1
          AND o."sellerTenantId" != $1
        GROUP BY l."productId", p."name", p."nameAr"
        ORDER BY COUNT(o.id) DESC
        LIMIT 10
      `, [pharmacyTenantId]),

      // City density (seller count per city)
      this.dataSource.query<any[]>(`
        SELECT
          sp.city,
          COUNT(DISTINCT sp."pharmacyTenantId")::int AS "sellerCount"
        FROM seller_profiles sp
        WHERE sp."verificationStatus" = 'verified'
          AND sp."isVisible" = true
          AND sp.city IS NOT NULL
          AND sp."pharmacyTenantId" != $1
        GROUP BY sp.city
        ORDER BY COUNT(*) DESC
        LIMIT 10
      `, [pharmacyTenantId]),
    ]);

    return {
      activeSellersCount: parseInt(summary?.sellers ?? '0', 10),
      activeListingsCount: parseInt(summary?.listings ?? '0', 10),
      avgPricesByProduct: avgPrices.map((r) => ({
        productId: r.productId,
        avgPrice: Number(r.avgPrice),
        minPrice: Number(r.minPrice),
        maxPrice: Number(r.maxPrice),
        listingsCount: Number(r.listingsCount),
      })),
      topTradedProducts: topProducts.map((r) => ({
        productId: r.productId,
        productName: r.productName ?? null,
        productNameAr: r.productNameAr ?? null,
        orderCount: Number(r.orderCount),
        totalVolume: Number(r.totalVolume),
      })),
      cityDensity: cityDensity.map((r) => ({
        city: r.city,
        sellerCount: Number(r.sellerCount),
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}

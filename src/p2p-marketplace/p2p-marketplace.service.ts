import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { P2pListing } from '../p2p-listing/entities/p2p-listing.entity';
import { SellerProfile } from '../p2p-seller/entities/seller-profile.entity';
import { SellerReliabilityScore } from '../p2p-seller/entities/seller-reliability-score.entity';
import { SearchMarketplaceDto } from './dto/search-marketplace.dto';
import { normalizePagination } from '../common/pagination/pagination-query.dto';

export interface MarketplaceListingResult {
  listing: P2pListing;
  seller: Partial<SellerProfile>;
  reliability: Partial<SellerReliabilityScore>;
  rankScore: number;
  distanceKm?: number;
}

@Injectable()
export class P2pMarketplaceService {
  private readonly logger = new Logger(P2pMarketplaceService.name);

  constructor(
    @InjectRepository(P2pListing)
    private readonly listingRepo: Repository<P2pListing>,
  ) {}

  async search(
    buyerTenantId: string,
    dto: SearchMarketplaceDto,
  ): Promise<{ data: MarketplaceListingResult[]; total: number; limit: number; offset: number }> {
    const { limit, offset } = normalizePagination({ limit: dto.limit, offset: dto.offset });

    let buyerLat: number | null = null;
    let buyerLng: number | null = null;
    if (dto.buyerGps) {
      const [a, b] = dto.buyerGps.split(',');
      const parsedLat = parseFloat(a);
      const parsedLng = parseFloat(b);
      if (isFinite(parsedLat) && isFinite(parsedLng)) {
        buyerLat = parsedLat;
        buyerLng = parsedLng;
      }
    }
    const maxRadius = dto.radiusKm ?? 50;

    // ── Build base queryBuilder (used for both COUNT and data) ────────────────
    const qb = this.listingRepo
      .createQueryBuilder('l')
      // Seller profile: must be verified + visible
      .innerJoin(
        'seller_profiles',
        'sp',
        'sp."pharmacyTenantId" = l."sellerTenantId" AND sp."verificationStatus" = \'verified\' AND sp."isVisible" = true',
      )
      // Reliability score: optional — new sellers won't have one yet
      .leftJoin(
        'seller_reliability_scores',
        'srs',
        'srs."pharmacyTenantId" = l."sellerTenantId"',
      )
      .where('l.status = :status', { status: 'active' })
      .andWhere('l.quantity > 0')
      .andWhere('l."sellerTenantId" != :buyer', { buyer: buyerTenantId })
      // Always join products so listing results carry name/barcode/strength
      .leftJoin('products', 'prod', 'prod.id = l."productId"');

    // ── Dynamic filters ───────────────────────────────────────────────────────
    if (dto.q) {
      qb.andWhere(
        '(prod.name ILIKE :q OR prod."nameAr" ILIKE :q OR prod."genericName" ILIKE :q OR prod.barcode ILIKE :q)',
        { q: `%${dto.q}%` },
      );
    }

    if (dto.listingType) {
      qb.andWhere('l."listingType" = :type', { type: dto.listingType });
    }
    if (dto.minPrice != null) {
      qb.andWhere('l.price >= :minPrice', { minPrice: dto.minPrice });
    }
    if (dto.maxPrice != null) {
      qb.andWhere('l.price <= :maxPrice', { maxPrice: dto.maxPrice });
    }
    if (dto.city) {
      qb.andWhere('sp.city ILIKE :city', { city: `%${dto.city}%` });
    }
    if (dto.minSellerScore != null) {
      qb.andWhere('COALESCE(srs."overallScore", 0) >= :minScore', {
        minScore: dto.minSellerScore,
      });
    }

    // ── COUNT (fast — uses only WHERE + JOIN, no expressions) ─────────────────
    const total = await qb.getCount();

    if (total === 0) {
      return { data: [], total: 0, limit, offset };
    }

    // ── Rank expressions (pure SQL — runs in DB, not TypeScript) ─────────────
    // Haversine distance in km (GPS stored as "lat,lng" string)
    const hasGps = buyerLat !== null;
    const distanceExpr = hasGps
      ? `(6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
            cos(radians(${buyerLat})) * cos(radians(split_part(sp."gpsLocation",',',1)::float))
            * cos(radians(split_part(sp."gpsLocation",',',2)::float) - radians(${buyerLng}))
            + sin(radians(${buyerLat})) * sin(radians(split_part(sp."gpsLocation",',',1)::float))
          )))`
      : 'NULL::float';

    // Global price ceiling (subquery over the filtered active listings)
    // Wrapped in NULLIF to avoid division by zero
    const maxPriceSub = `(SELECT NULLIF(MAX(l2.price), 0)
      FROM p2p_listings l2
      WHERE l2.status = 'active' AND l2.quantity > 0)`;

    const rankExpr = `(
      -- Availability (0–1): more stock = better, saturates at 50 units
      LEAST(1.0, l.quantity::float / 50.0) * 0.25

      -- Distance (0–1): closer = better; neutral 0.5 when no GPS
      + CASE
          WHEN sp."gpsLocation" IS NOT NULL AND ${hasGps ? 'TRUE' : 'FALSE'}
          THEN GREATEST(0.0, 1.0 - ${distanceExpr} / ${maxRadius})
          ELSE 0.5
        END * 0.25

      -- Price (0–1): cheaper relative to global max = better
      + (1.0 - l.price::float / COALESCE(${maxPriceSub}, l.price::float)) * 0.20

      -- Seller reliability (0–1)
      + (COALESCE(srs."overallScore", 30.0) / 100.0) * 0.15

      -- Expiry (0–1): longer shelf life = better; neutral 0.5 when no date
      + CASE
          WHEN l."expiryDate" IS NOT NULL
          THEN LEAST(1.0, GREATEST(0.0,
            EXTRACT(EPOCH FROM (l."expiryDate"::timestamp - now())) / 86400.0 / 180.0
          ))
          ELSE 0.5
        END * 0.10

      -- Delivery placeholder (0.5 until ETA system exists)
      + 0.5 * 0.05
    )`;

    const distanceSelect = hasGps
      ? `CASE WHEN sp."gpsLocation" IS NOT NULL THEN ${distanceExpr} ELSE NULL END`
      : 'NULL::float';

    // ── Data query: rank + paginate entirely in DB ────────────────────────────
    const rows = await qb
      .select('l.id', 'id')
      .addSelect('l."sellerTenantId"', 'sellerTenantId')
      .addSelect('l."inventoryItemId"', 'inventoryItemId')
      .addSelect('l."productId"', 'productId')
      .addSelect('l.price', 'price')
      .addSelect('l.quantity', 'quantity')
      .addSelect('l."minOrderQty"', 'minOrderQty')
      .addSelect('l."expiryDate"', 'expiryDate')
      .addSelect('l.status', 'status')
      .addSelect('l."listingType"', 'listingType')
      .addSelect('l."offerType"', 'offerType')
      .addSelect('l."discountPct"', 'discountPct')
      .addSelect('l."bonusQty"', 'bonusQty')
      .addSelect('l."autoUpdateDiscount"', 'autoUpdateDiscount')
      .addSelect('l."createdAt"', 'createdAt')
      .addSelect('l."updatedAt"', 'updatedAt')
      // Product fields — carried on every listing for display
      .addSelect('prod.name', 'productName')
      .addSelect('prod."nameAr"', 'productNameAr')
      .addSelect('prod.barcode', 'productBarcode')
      .addSelect('prod.sku', 'productCode')
      .addSelect('prod.strength', 'productStrength')
      .addSelect('prod."dosageForm"', 'productDosageForm')
      .addSelect('prod.manufacturer', 'productManufacturer')
      // Seller fields
      .addSelect('sp."legalName"', 'sellerLegalName')
      .addSelect('sp.city', 'sellerCity')
      .addSelect('sp.region', 'sellerRegion')
      .addSelect('sp."gpsLocation"', 'sellerGps')
      // Reliability fields
      .addSelect('COALESCE(srs."overallScore", 30)', 'overallScore')
      .addSelect('srs."trustLevel"', 'trustLevel')
      .addSelect('srs.label', 'reliabilityLabel')
      // Computed
      .addSelect(rankExpr, 'rankScore')
      .addSelect(distanceSelect, 'distanceKm')
      // ORDER + PAGINATE in DB — not in TypeScript
      .orderBy(rankExpr, 'DESC')
      .take(limit)
      .skip(offset)
      .getRawMany();

    const data: MarketplaceListingResult[] = rows.map((r) => ({
      listing: {
        id: r.id,
        sellerTenantId: r.sellerTenantId,
        inventoryItemId: r.inventoryItemId,
        productId: r.productId,
        price: Number(r.price),
        quantity: Number(r.quantity),
        minOrderQty: Number(r.minOrderQty),
        expiryDate: r.expiryDate ?? null,
        status: r.status,
        listingType: r.listingType,
        offerType: r.offerType ?? 'none',
        discountPct: r.discountPct != null ? Number(r.discountPct) : undefined,
        bonusQty: r.bonusQty != null ? Number(r.bonusQty) : undefined,
        autoUpdateDiscount: r.autoUpdateDiscount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        // Enriched from products join
        productName:         r.productName         ?? null,
        productNameAr:       r.productNameAr       ?? null,
        productBarcode:      r.productBarcode      ?? null,
        productCode:         r.productCode         ?? null,
        productStrength:     r.productStrength     ?? null,
        productDosageForm:   r.productDosageForm   ?? null,
        productManufacturer: r.productManufacturer ?? null,
      } as P2pListing,
      seller: {
        pharmacyTenantId: r.sellerTenantId,
        legalName: r.sellerLegalName ?? null,
        city: r.sellerCity ?? null,
        region: r.sellerRegion ?? null,
      },
      reliability: {
        overallScore: Number(r.overallScore),
        trustLevel: r.trustLevel ?? 'bronze',
        label: r.reliabilityLabel ?? '',
      },
      rankScore: Number(r.rankScore ?? 0),
      distanceKm: r.distanceKm != null ? Number(r.distanceKm) : undefined,
    }));

    return { data, total, limit, offset };
  }

  /**
   * Urgent finder — distance-first, no complex ranking.
   * Shows emergency listings (+ active normal if buyer GPS provided) sorted
   * by proximity so the pharmacist can call the nearest one immediately.
   */
  async searchUrgent(
    buyerTenantId: string,
    buyerGps?: string,
    limit = 20,
    offset = 0,
  ): Promise<{ data: MarketplaceListingResult[]; total: number; limit: number; offset: number }> {
    let buyerLat: number | null = null;
    let buyerLng: number | null = null;
    if (buyerGps) {
      const [a, b] = buyerGps.split(',');
      const lat = parseFloat(a); const lng = parseFloat(b);
      if (isFinite(lat) && isFinite(lng)) { buyerLat = lat; buyerLng = lng; }
    }

    const distanceExpr = buyerLat !== null
      ? `(6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
            cos(radians(${buyerLat})) * cos(radians(split_part(sp."gpsLocation",',',1)::float))
            * cos(radians(split_part(sp."gpsLocation",',',2)::float) - radians(${buyerLng}))
            + sin(radians(${buyerLat})) * sin(radians(split_part(sp."gpsLocation",',',1)::float))
          )))`
      : '9999::float';

    const qb = this.listingRepo
      .createQueryBuilder('l')
      .innerJoin('seller_profiles', 'sp',
        'sp."pharmacyTenantId" = l."sellerTenantId" AND sp."verificationStatus" = \'verified\' AND sp."isVisible" = true')
      .leftJoin('seller_reliability_scores', 'srs', 'srs."pharmacyTenantId" = l."sellerTenantId"')
      .where('l.status = :status', { status: 'active' })
      .andWhere('l.quantity > 0')
      .andWhere('l."sellerTenantId" != :buyer', { buyer: buyerTenantId })
      // Urgent = emergency type OR (any active + near-expiry within 30 days)
      .andWhere(
        '(l."listingType" = \'emergency\' OR (l."expiryDate" IS NOT NULL AND l."expiryDate" <= :soon))',
        { soon: new Date(Date.now() + 30 * 86_400_000) },
      );

    const total = await qb.getCount();
    if (total === 0) return { data: [], total: 0, limit, offset };

    const rows = await qb
      .select('l.id', 'id')
      .addSelect('l."sellerTenantId"', 'sellerTenantId')
      .addSelect('l."inventoryItemId"', 'inventoryItemId')
      .addSelect('l."productId"', 'productId')
      .addSelect('l.price', 'price')
      .addSelect('l.quantity', 'quantity')
      .addSelect('l."minOrderQty"', 'minOrderQty')
      .addSelect('l."expiryDate"', 'expiryDate')
      .addSelect('l.status', 'status')
      .addSelect('l."listingType"', 'listingType')
      .addSelect('l."offerType"', 'offerType')
      .addSelect('l."discountPct"', 'discountPct')
      .addSelect('l."autoUpdateDiscount"', 'autoUpdateDiscount')
      .addSelect('l."createdAt"', 'createdAt')
      .addSelect('l."updatedAt"', 'updatedAt')
      .addSelect('sp."legalName"', 'sellerLegalName')
      .addSelect('sp.city', 'sellerCity')
      .addSelect('sp."gpsLocation"', 'sellerGps')
      .addSelect('sp."deliveryZones"', 'sellerDeliveryZones')
      .addSelect('COALESCE(srs."overallScore", 30)', 'overallScore')
      .addSelect('srs."trustLevel"', 'trustLevel')
      .addSelect(distanceExpr, 'distanceKm')
      .orderBy(distanceExpr, 'ASC')
      .addOrderBy('l.quantity', 'DESC')
      .take(limit)
      .skip(offset)
      .getRawMany();

    return {
      data: rows.map((r) => ({
        listing: {
          id: r.id, sellerTenantId: r.sellerTenantId, inventoryItemId: r.inventoryItemId,
          productId: r.productId, price: Number(r.price), quantity: Number(r.quantity),
          minOrderQty: Number(r.minOrderQty), expiryDate: r.expiryDate ?? null,
          status: r.status, listingType: r.listingType, offerType: r.offerType ?? 'none',
          discountPct: r.discountPct != null ? Number(r.discountPct) : undefined,
          autoUpdateDiscount: r.autoUpdateDiscount, createdAt: r.createdAt, updatedAt: r.updatedAt,
        } as P2pListing,
        seller: {
          pharmacyTenantId: r.sellerTenantId, legalName: r.sellerLegalName ?? null,
          city: r.sellerCity ?? null,
        },
        reliability: { overallScore: Number(r.overallScore), trustLevel: r.trustLevel ?? 'bronze' },
        rankScore: Number(r.overallScore ?? 30) / 100,
        distanceKm: r.distanceKm != null && Number(r.distanceKm) < 9998 ? Number(r.distanceKm) : undefined,
      })),
      total,
      limit,
      offset,
    };
  }

  async getListing(
    buyerTenantId: string,
    listingId: string,
  ): Promise<MarketplaceListingResult | null> {
    const rows = await this.listingRepo
      .createQueryBuilder('l')
      .innerJoin(
        'seller_profiles',
        'sp',
        'sp."pharmacyTenantId" = l."sellerTenantId" AND sp."verificationStatus" = \'verified\'',
      )
      .leftJoin(
        'seller_reliability_scores',
        'srs',
        'srs."pharmacyTenantId" = l."sellerTenantId"',
      )
      .where('l.id = :id', { id: listingId })
      .andWhere('l.status = :status', { status: 'active' })
      .andWhere('l."sellerTenantId" != :buyer', { buyer: buyerTenantId })
      .select('l.id', 'id')
      .addSelect('l."sellerTenantId"', 'sellerTenantId')
      .addSelect('l."inventoryItemId"', 'inventoryItemId')
      .addSelect('l."productId"', 'productId')
      .addSelect('l.price', 'price')
      .addSelect('l.quantity', 'quantity')
      .addSelect('l."minOrderQty"', 'minOrderQty')
      .addSelect('l."expiryDate"', 'expiryDate')
      .addSelect('l.status', 'status')
      .addSelect('l."listingType"', 'listingType')
      .addSelect('l."offerType"', 'offerType')
      .addSelect('l."discountPct"', 'discountPct')
      .addSelect('l."bonusQty"', 'bonusQty')
      .addSelect('l."autoUpdateDiscount"', 'autoUpdateDiscount')
      .addSelect('l."createdAt"', 'createdAt')
      .addSelect('l."updatedAt"', 'updatedAt')
      .addSelect('sp."legalName"', 'sellerLegalName')
      .addSelect('sp.city', 'sellerCity')
      .addSelect('sp.region', 'sellerRegion')
      .addSelect('COALESCE(srs."overallScore", 30)', 'overallScore')
      .addSelect('srs."trustLevel"', 'trustLevel')
      .addSelect('srs.label', 'reliabilityLabel')
      .getRawMany();

    if (!rows.length) return null;
    const r = rows[0];

    return {
      listing: {
        id: r.id,
        sellerTenantId: r.sellerTenantId,
        inventoryItemId: r.inventoryItemId,
        productId: r.productId,
        price: Number(r.price),
        quantity: Number(r.quantity),
        minOrderQty: Number(r.minOrderQty),
        expiryDate: r.expiryDate ?? null,
        status: r.status,
        listingType: r.listingType,
        offerType: r.offerType ?? 'none',
        discountPct: r.discountPct != null ? Number(r.discountPct) : undefined,
        bonusQty: r.bonusQty != null ? Number(r.bonusQty) : undefined,
        autoUpdateDiscount: r.autoUpdateDiscount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      } as P2pListing,
      seller: {
        pharmacyTenantId: r.sellerTenantId,
        legalName: r.sellerLegalName ?? null,
        city: r.sellerCity ?? null,
        region: r.sellerRegion ?? null,
      },
      reliability: {
        overallScore: Number(r.overallScore),
        trustLevel: r.trustLevel ?? 'bronze',
        label: r.reliabilityLabel ?? '',
      },
      rankScore: Number(r.overallScore ?? 30) / 100,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PriceSnapshot } from './entities/price-snapshot.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { SupplierProfile } from '../supplier/entities/supplier-profile.entity';
import { WeeklyAnalyticsSnapshot } from './entities/weekly-analytics-snapshot.entity';

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

  // ─── Pharmacy Dashboard Analytics ─────────────────────────────────────────

  async getWeeklySnapshots(tenantId: string, weeks = 12): Promise<WeeklyAnalyticsSnapshot[]> {
    return this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId })
      .orderBy('s.weekStart', 'DESC')
      .take(weeks)
      .getMany();
  }
}

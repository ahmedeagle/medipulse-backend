import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { MarketAvailabilitySnapshot } from './entities/market-availability-snapshot.entity';

export interface MarketAvailabilityResult {
  productId: string;
  productName?: string;        // resolved medicine name for end-user display
  availabilityRate: number;   // 0–1
  activeSuppliers: number;
  totalSuppliers: number;
  lowestActivePrice: number | null;
  status: 'green' | 'yellow' | 'red';  // >80% / 50–80% / <50%
  recordedAt: Date;
}

@Injectable()
export class MarketAvailabilityService {
  private readonly logger = new Logger(MarketAvailabilityService.name);

  constructor(
    @InjectRepository(MarketAvailabilitySnapshot)
    private readonly snapshotRepo: Repository<MarketAvailabilitySnapshot>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── CRON: daily 4am ─────────────────────────────────────────────────────────

  // 5-minute TTL cache — eliminates per-cart-add DB round-trips for getLatest()
  private readonly latestCache = new Map<string, { result: MarketAvailabilityResult; expiresAt: number }>();

  @Cron('0 4 * * *', { name: 'market-availability-daily' })
  async runDailySnapshot(): Promise<void> {
    this.logger.log('Market availability daily snapshot started');

    // Single GROUP BY query for ALL products — was N queries in a loop before
    const rows: Array<{
      productId: string;
      total_suppliers: number;
      active_suppliers: number;
      lowest_active_price: string | null;
    }> = await this.dataSource.query(`
      SELECT
        "productId",
        COUNT(DISTINCT "supplierTenantId")::int                                                AS total_suppliers,
        COUNT(DISTINCT CASE WHEN "isAvailable" = true AND stock > 0 THEN "supplierTenantId" END)::int
                                                                                               AS active_suppliers,
        MIN(CASE WHEN "isAvailable" = true AND stock > 0 THEN price END)::text                AS lowest_active_price
      FROM supplier_catalog
      WHERE "deletedAt" IS NULL
      GROUP BY "productId"
    `);

    if (!rows.length) {
      this.logger.log('Market availability snapshot — no products found');
      return;
    }

    const now = new Date();
    const snapshots = rows.map((r) => {
      const total  = r.total_suppliers;
      const active = r.active_suppliers;
      const rate   = total > 0 ? active / total : 1.0;
      return this.snapshotRepo.create({
        productId: r.productId,
        availabilityRate: rate,
        activeSuppliers: active,
        totalSuppliers: total,
        lowestActivePrice: r.lowest_active_price ? parseFloat(r.lowest_active_price) : null,
        recordedAt: now,
      });
    });

    // Bulk save in chunks to stay within query-param limits
    const CHUNK = 500;
    for (let i = 0; i < snapshots.length; i += CHUNK) {
      await this.snapshotRepo.save(snapshots.slice(i, i + CHUNK));
    }

    // Invalidate in-memory cache so fresh data is served immediately after cron
    this.latestCache.clear();

    // Cleanup: bound table size to 90-day window
    await this.dataSource.query(`
      DELETE FROM market_availability_snapshots
      WHERE "recordedAt" < NOW() - INTERVAL '90 days'
    `);

    this.logger.log(`Market availability snapshot complete — ${snapshots.length} products`);

    // ── Shortage notifications ─────────────────────────────────────────────────
    await this.notifyPharmaciesOnShortage(snapshots);
  }

  // ─── SHORTAGE NOTIFICATIONS ──────────────────────────────────────────────────

  private async notifyPharmaciesOnShortage(
    snapshots: MarketAvailabilitySnapshot[],
  ): Promise<void> {
    const redProducts = snapshots.filter((s) => s.availabilityRate < 0.50);
    if (!redProducts.length) return;

    // Resolve product names
    const productIds = redProducts.map((s) => s.productId);
    const products: { id: string; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM products WHERE id = ANY($1::uuid[])`,
      [productIds],
    );
    const nameMap = new Map(products.map((p) => [p.id, p.name]));
    const productList = redProducts
      .slice(0, 5)
      .map((s) => nameMap.get(s.productId) ?? 'منتج')
      .join('، ');

    // Find all pharmacy tenants (deduplicated)
    const pharmacies: { tenantId: string }[] = await this.dataSource.query(
      `SELECT DISTINCT "tenantId" FROM users WHERE role = 'pharmacy_admin' LIMIT 2000`,
    );
    if (!pharmacies.length) return;

    const title = `⚠️ شح في السوق — ${redProducts.length} منتج`;
    const body =
      `${productList} — الكميات المتوفرة لدى الموردين منخفضة جداً (أقل من 50% من الطاقة الاعتيادية). ` +
      `نُنصح بالشراء المبكر قبل نفاد المعروض. افتح مركز الذكاء لإنشاء خطة شراء.`;

    // Insert one notification per pharmacy — skip if already notified in last 24h
    for (const pharmacy of pharmacies) {
      try {
        await this.dataSource.query(
          `INSERT INTO notifications ("tenantId", type, title, body, "isRead", "createdAt")
           SELECT $1, 'market_shortage', $2, $3, false, NOW()
           WHERE NOT EXISTS (
             SELECT 1 FROM notifications
             WHERE "tenantId" = $1
               AND type = 'market_shortage'
               AND "createdAt" > NOW() - INTERVAL '24 hours'
           )`,
          [pharmacy.tenantId, title, body],
        );
      } catch {
        // Non-critical — log and continue
        this.logger.warn(`Failed to insert market_shortage notification for tenant ${pharmacy.tenantId}`);
      }
    }

    this.logger.log(`Market shortage notifications sent to ${pharmacies.length} pharmacies for ${redProducts.length} red products`);
  }

  // ─── COMPUTE + SAVE ──────────────────────────────────────────────────────────

  /**
   * Computes the current market availability for a product from the live catalog.
   * Stores a new snapshot and returns the result.
   *
   * SQL: single aggregation query — no N+1.
   */
  async computeAndSave(productId: string): Promise<MarketAvailabilityResult> {
    const rows: Array<{
      total_suppliers: string;
      active_suppliers: string;
      lowest_active_price: string | null;
    }> = await this.dataSource.query(
      `
      SELECT
        COUNT(DISTINCT "supplierTenantId")::text                                          AS total_suppliers,
        COUNT(DISTINCT CASE WHEN "isAvailable" = true AND stock > 0 THEN "supplierTenantId" END)::text
                                                                                          AS active_suppliers,
        MIN(CASE WHEN "isAvailable" = true AND stock > 0 THEN price END)::text            AS lowest_active_price
      FROM supplier_catalog
      WHERE "productId" = $1
        AND "deletedAt" IS NULL
      `,
      [productId],
    );

    const row = rows[0];
    const total  = parseInt(row.total_suppliers, 10) || 0;
    const active = parseInt(row.active_suppliers, 10) || 0;
    const lowestPrice = row.lowest_active_price ? parseFloat(row.lowest_active_price) : null;
    const rate   = total > 0 ? active / total : 1.0; // default 1.0 if no data (no shortage signal)

    const snapshot = this.snapshotRepo.create({
      productId,
      availabilityRate: rate,
      activeSuppliers: active,
      totalSuppliers: total,
      lowestActivePrice: lowestPrice,
    });
    await this.snapshotRepo.save(snapshot);
    this.latestCache.delete(productId);

    return this.toResult(snapshot);
  }

  // ─── GET LATEST ──────────────────────────────────────────────────────────────

  /**
   * Returns the most recent snapshot for a product.
   * Falls back to a live compute if no snapshot exists yet.
   * Used by ProcurementOrchestrator Layer 1 (with 4s timeout guard on the caller side).
   */
  async getLatest(productId: string): Promise<MarketAvailabilityResult> {
    const cached = this.latestCache.get(productId);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const snapshot = await this.snapshotRepo.findOne({
      where: { productId },
      order: { recordedAt: 'DESC' },
    });

    const result = snapshot ? this.toResult(snapshot) : await this.computeAndSave(productId);
    this.latestCache.set(productId, { result, expiresAt: Date.now() + 5 * 60_000 });
    return result;
  }

  // ─── TREND (last 30 days) ─────────────────────────────────────────────────────

  /**
   * Returns daily availability rate for a product over the past N days.
   * Used by the market availability widget in the AI Center.
   */
  async getTrend(productId: string, days = 30): Promise<Array<{ date: string; rate: number }>> {
    const rows: Array<{ day: string; rate: string }> = await this.dataSource.query(
      `
      SELECT
        date_trunc('day', "recordedAt")::date::text AS day,
        AVG("availabilityRate")::text               AS rate
      FROM market_availability_snapshots
      WHERE "productId" = $1
        AND "recordedAt" >= NOW() - ($2 || ' days')::interval
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [productId, days],
    );
    return rows.map((r) => ({ date: r.day, rate: parseFloat(r.rate) }));
  }

  // ─── AT-RISK PRODUCTS ─────────────────────────────────────────────────────────

  /**
   * Returns top N products with availability rate < 50% from the latest snapshots.
   * Used by the AI Center DashboardTab to surface proactive alerts.
   */
  async getAtRiskProducts(limit = 10): Promise<MarketAvailabilityResult[]> {
    const rows: Array<{
      productId: string;
      productName: string | null;
      availabilityRate: string;
      activeSuppliers: string;
      totalSuppliers: string;
      lowestActivePrice: string | null;
      recordedAt: Date;
    }> = await this.dataSource.query(
      `
      SELECT DISTINCT ON (s."productId")
        s."productId",
        COALESCE(p."nameAr", p.name)  AS "productName",
        s."availabilityRate"::text,
        s."activeSuppliers"::text,
        s."totalSuppliers"::text,
        s."lowestActivePrice"::text,
        s."recordedAt"
      FROM market_availability_snapshots s
      LEFT JOIN products p ON p.id = s."productId"
      WHERE s."availabilityRate" < 0.50
      ORDER BY s."productId", s."recordedAt" DESC
      LIMIT $1
      `,
      [limit],
    );

    return rows.map((r) => ({
      productId: r.productId,
      productName: r.productName ?? undefined,
      availabilityRate: parseFloat(r.availabilityRate),
      activeSuppliers: parseInt(r.activeSuppliers, 10),
      totalSuppliers: parseInt(r.totalSuppliers, 10),
      lowestActivePrice: r.lowestActivePrice ? parseFloat(r.lowestActivePrice) : null,
      status: this.rateToStatus(parseFloat(r.availabilityRate)),
      recordedAt: r.recordedAt,
    }));
  }

  // ─── PRIVATE ─────────────────────────────────────────────────────────────────

  private toResult(s: MarketAvailabilitySnapshot): MarketAvailabilityResult {
    const rate = parseFloat(s.availabilityRate as any);
    return {
      productId: s.productId,
      availabilityRate: rate,
      activeSuppliers: s.activeSuppliers,
      totalSuppliers: s.totalSuppliers,
      lowestActivePrice: s.lowestActivePrice ? parseFloat(s.lowestActivePrice as any) : null,
      status: this.rateToStatus(rate),
      recordedAt: s.recordedAt,
    };
  }

  private rateToStatus(rate: number): 'green' | 'yellow' | 'red' {
    if (rate > 0.80) return 'green';
    if (rate >= 0.50) return 'yellow';
    return 'red';
  }
}

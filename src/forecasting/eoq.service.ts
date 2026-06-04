import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ProcurementSchedule } from './entities/procurement-schedule.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { PreferredSupplier } from '../supplier/entities/preferred-supplier.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { TenantType } from '../common/enums/tenant-type.enum';

/**
 * Economic Order Quantity (EOQ) + Safety Stock + Reorder Point
 *
 * Classic Wilson EOQ formula adapted for pharmaceutical procurement:
 *
 *   EOQ = sqrt( (2 × D × K) / H )
 *
 *   D = annual demand (units/year)
 *   K = fixed ordering cost per order (default SAR 50)
 *   H = annual holding cost per unit (15% of unit price)
 *
 *   Safety Stock = z × σ_daily × √leadTime
 *   z = 1.645 (95% service level — standard for healthcare)
 *
 *   Reorder Point (ROP) = (avgDailyDemand × leadTimeDays) + safetyStock
 *
 * Dynamic lead time: uses supplier's avgDeliveryDays from reliability score.
 * Preferred suppliers get priority when multiple suppliers carry the product.
 */

const ORDERING_COST_SAR = 50;    // fixed cost per purchase order (SAR)
const HOLDING_COST_RATE = 0.15;  // 15% of unit price per year
const SERVICE_LEVEL_Z   = 1.645; // 95% service level
const DEFAULT_LEAD_DAYS = 14;

export interface EoqResult {
  eoqQty:                     number;
  safetyStockQty:             number;
  reorderPoint:               number;
  effectiveLeadTimeDays:      number;
  recommendedSupplierTenantId?: string;
  reorderByDate?:             Date;
  predictedStockoutDate?:     Date;
  daysUntilReorderNeeded?:    number;
}

@Injectable()
export class EoqService {
  constructor(
    @InjectRepository(ProcurementSchedule)
    private readonly scheduleRepo: Repository<ProcurementSchedule>,
    @InjectRepository(ConsumptionSnapshot)
    private readonly snapshotRepo: Repository<ConsumptionSnapshot>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(SupplierCatalogItem)
    private readonly catalogRepo: Repository<SupplierCatalogItem>,
    @InjectRepository(SupplierReliabilityScore)
    private readonly scoreRepo: Repository<SupplierReliabilityScore>,
    @InjectRepository(PreferredSupplier)
    private readonly preferredRepo: Repository<PreferredSupplier>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  // ─── Daily cron: refresh EOQ and schedules ────────────────────────────────

  @Cron('0 3 * * *')  // 3am daily
  async refreshAllSchedules(): Promise<void> {
    const pharmacies = await this.tenantRepo.find({
      where: { type: TenantType.PHARMACY, isActive: true },
    });
    for (const pharmacy of pharmacies) {
      await this.refreshForPharmacy(pharmacy.id).catch(() => {});
    }
  }

  async refreshForPharmacy(tenantId: string): Promise<void> {
    const inventoryItems = await this.inventoryRepo
      .createQueryBuilder('i')
      .where('i.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('i.deletedAt IS NULL')
      .getMany();

    for (const item of inventoryItems) {
      const result = await this.calculateEoq(tenantId, item.productId, item.quantity);
      await this.upsertSchedule(tenantId, item.productId, result);
    }
  }

  // ─── Core EOQ calculation ─────────────────────────────────────────────────

  async calculateEoq(
    tenantId: string,
    productId: string,
    currentQuantity: number,
  ): Promise<EoqResult> {
    const snapshots = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.productId = :productId', { productId })
      .orderBy('s.weekStart', 'DESC')
      .take(12)
      .getMany();

    const weeklyQtys = snapshots.map((s) => s.quantityConsumed);
    const avgWeekly  = weeklyQtys.length
      ? weeklyQtys.reduce((a, b) => a + b, 0) / weeklyQtys.length
      : 0;
    const avgDaily   = avgWeekly / 7;
    const annualDemand = avgDaily * 365;

    // Demand variability (std dev for safety stock)
    const variance = weeklyQtys.length >= 2
      ? weeklyQtys.reduce((s, q) => s + Math.pow(q - avgWeekly, 2), 0) / weeklyQtys.length
      : Math.pow(avgWeekly * 0.2, 2);
    const stdDevDaily = Math.sqrt(variance) / 7;

    // Best supplier — preferred first, then most reliable
    const { supplierTenantId, leadDays, unitPrice } =
      await this.getBestSupplier(tenantId, productId);

    // EOQ = sqrt(2DK/H)
    const holdingCostPerUnit = unitPrice * HOLDING_COST_RATE;
    const eoqQty = holdingCostPerUnit > 0 && annualDemand > 0
      ? Math.ceil(Math.sqrt((2 * annualDemand * ORDERING_COST_SAR) / holdingCostPerUnit))
      : Math.max(10, Math.ceil(avgWeekly * 2));

    // Safety stock = z × σ_daily × √leadTime
    const safetyStockQty = Math.ceil(SERVICE_LEVEL_Z * stdDevDaily * Math.sqrt(leadDays));

    // Reorder point = (avgDailyDemand × leadTime) + safetyStock
    const reorderPoint = Math.ceil((avgDaily * leadDays) + safetyStockQty);

    // Schedule dates
    const now = Date.now();
    let reorderByDate: Date | undefined;
    let predictedStockoutDate: Date | undefined;
    let daysUntilReorderNeeded: number | undefined;

    if (avgDaily > 0) {
      const daysOfStock = currentQuantity / avgDaily;
      predictedStockoutDate = new Date(now + daysOfStock * 86_400_000);

      // Need to order when stock hits ROP — how many days until we hit ROP?
      const daysUntilRop = currentQuantity > reorderPoint
        ? (currentQuantity - reorderPoint) / avgDaily
        : 0;
      reorderByDate          = new Date(now + daysUntilRop * 86_400_000);
      daysUntilReorderNeeded = Math.max(0, Math.floor(daysUntilRop));
    }

    return {
      eoqQty:                     Math.max(1, eoqQty),
      safetyStockQty:             Math.max(0, safetyStockQty),
      reorderPoint:               Math.max(0, reorderPoint),
      effectiveLeadTimeDays:      leadDays,
      recommendedSupplierTenantId: supplierTenantId,
      reorderByDate,
      predictedStockoutDate,
      daysUntilReorderNeeded,
    };
  }

  // ─── Bulk lookup for rules engine ─────────────────────────────────────────

  async getScheduleMap(
    tenantId: string,
    productIds: string[],
  ): Promise<Map<string, ProcurementSchedule>> {
    if (!productIds.length) return new Map();
    const schedules = await this.scheduleRepo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.productId IN (:...productIds)', { productIds })
      .getMany();
    return new Map(schedules.map((s) => [s.productId, s]));
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async getBestSupplier(
    tenantId: string,
    productId: string,
  ): Promise<{ supplierTenantId: string | undefined; leadDays: number; unitPrice: number }> {
    const listings = await this.catalogRepo
      .createQueryBuilder('c')
      .where('c.productId = :productId', { productId })
      .andWhere('c.isAvailable = true')
      .andWhere('c.deletedAt IS NULL')
      .getMany();

    if (!listings.length) {
      return { supplierTenantId: undefined, leadDays: DEFAULT_LEAD_DAYS, unitPrice: 0 };
    }

    // Score each supplier: preferred × 50 + reliability × 30 + price_rank × 20
    const preferred = await this.preferredRepo
      .find({ where: { pharmacyTenantId: tenantId } });
    const preferredMap = new Map(preferred.map((p) => [p.supplierTenantId, p.priority]));

    const scores = await this.scoreRepo.find({
      where: listings.map((l) => ({ supplierTenantId: l.supplierTenantId })),
    });
    const scoreMap = new Map(scores.map((s) => [s.supplierTenantId, s]));

    const maxPrice = Math.max(...listings.map((l) => Number(l.price)));
    const minPrice = Math.min(...listings.map((l) => Number(l.price)));
    const priceRange = maxPrice - minPrice || 1;

    const ranked = listings.map((l) => {
      const prefPriority  = preferredMap.has(l.supplierTenantId)
        ? (11 - (preferredMap.get(l.supplierTenantId) ?? 10)) * 5  // priority 1 = 50pts, 10 = 5pts
        : 0;
      const reliabilityScore = Number(scoreMap.get(l.supplierTenantId)?.overallScore ?? 50);
      const priceScore       = ((maxPrice - Number(l.price)) / priceRange) * 20;
      const totalScore       = prefPriority + reliabilityScore * 0.30 + priceScore;

      return { listing: l, score: totalScore };
    });

    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0].listing;
    const bestScore = scoreMap.get(best.supplierTenantId);
    const leadDays = bestScore?.avgDeliveryDays
      ? Math.ceil(Number(bestScore.avgDeliveryDays) * 1.2)  // 20% buffer
      : DEFAULT_LEAD_DAYS;

    return {
      supplierTenantId: best.supplierTenantId,
      leadDays:         Math.max(1, leadDays),
      unitPrice:        Number(best.price),
    };
  }

  private async upsertSchedule(
    tenantId: string,
    productId: string,
    result: EoqResult,
  ): Promise<void> {
    const existing = await this.scheduleRepo.findOne({ where: { tenantId, productId } });
    const payload  = { tenantId, productId, serviceLevel: SERVICE_LEVEL_Z, ...result };

    if (existing) {
      await this.scheduleRepo.update(existing.id, payload);
    } else {
      await this.scheduleRepo.save(this.scheduleRepo.create(payload));
    }
  }
}

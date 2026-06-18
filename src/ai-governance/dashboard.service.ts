import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Approval } from './entities/approval.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';

export interface DashboardWidget {
  key: string;
  titleAr: string;
  titleEn: string;
  count: number;
  severity: 'info' | 'warning' | 'danger' | 'success';
  iconKey: string;
  deepLink: string;
  emptyMessageAr?: string;
}

export interface WorkforceSummary {
  generatedAt: string;
  widgets: DashboardWidget[];
  expiryRiskEgp: number;
  pendingApprovals: {
    total: number;
    critical: number;
    high: number;
    byAgent: Array<{ agentCode: string; count: number }>;
  };
  topApprovals: Array<{
    id: string;
    title: string;
    summary: string;
    priority: string;
    agentCode: string;
    confidenceLabel: string;
    createdAt: string;
  }>;
}

const DAY_MS = 86_400_000;

/**
 * Aggregator for the Workforce Dashboard (PRD §8).
 *
 * Pulls READ-ONLY signals from existing domain tables — never mutates, never
 * triggers downstream side-effects. Designed to render the "show 5–10
 * critical actions max" home page in a single round-trip.
 *
 * Data sources:
 *   - `inventory_items`  → stock risks, expiry risks, dead stock, catalog issues
 *   - `approvals`        → pending approvals widget + top-priority preview
 *
 * Intentionally lightweight: 4 small SELECTs total, no joins to products
 * (the UI uses approval.title for the human-friendly label). Anything more
 * elaborate belongs in dedicated expert services (forecasting, EOQ, …)
 * which write their findings into the approvals queue.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Approval)      private readonly approvals: Repository<Approval>,
    @InjectRepository(InventoryItem) private readonly inventory: Repository<InventoryItem>,
  ) {}

  async summary(tenantId: string): Promise<WorkforceSummary> {
    const now = new Date();
    const in60d   = new Date(now.getTime() + 60 * DAY_MS);
    const in180d  = new Date(now.getTime() + 180 * DAY_MS);
    const dead60  = new Date(now.getTime() - 60 * DAY_MS);

    // Inventory KPIs ------------------------------------------------------
    const [stockRisk, outOfStock, nearExpiry, expired, deadStock, catalogIssues, expiryRiskRaw] =
      await Promise.all([
        this.inventory.createQueryBuilder('i')
          .where('i.pharmacyTenantId = :t', { t: tenantId })
          .andWhere('i.deletedAt IS NULL')
          .andWhere('i.quantity > 0')
          .andWhere('i.quantity <= i.minThreshold')
          .getCount(),
        this.inventory.createQueryBuilder('i')
          .where('i.pharmacyTenantId = :t', { t: tenantId })
          .andWhere('i.deletedAt IS NULL')
          .andWhere('i.quantity = 0')
          .getCount(),
        this.inventory.createQueryBuilder('i')
          .where('i.pharmacyTenantId = :t', { t: tenantId })
          .andWhere('i.deletedAt IS NULL')
          .andWhere('i.expiryDate IS NOT NULL')
          .andWhere('i.expiryDate >= :n', { n: now })
          .andWhere('i.expiryDate <= :f', { f: in60d })
          .getCount(),
        this.inventory.createQueryBuilder('i')
          .where('i.pharmacyTenantId = :t', { t: tenantId })
          .andWhere('i.deletedAt IS NULL')
          .andWhere('i.expiryDate IS NOT NULL')
          .andWhere('i.expiryDate < :n', { n: now })
          .getCount(),
        this.inventory.createQueryBuilder('i')
          .where('i.pharmacyTenantId = :t', { t: tenantId })
          .andWhere('i.deletedAt IS NULL')
          .andWhere('i.quantity > 0')
          .andWhere('i.updatedAt < :d', { d: dead60 })
          .getCount(),
        this.inventory.createQueryBuilder('i')
          .where('i.pharmacyTenantId = :t', { t: tenantId })
          .andWhere('i.deletedAt IS NULL')
          .andWhere(`i.linkStatus IN ('suggested', 'unlinked')`)
          .getCount(),
        // Financial value of stock expiring in next 180 days
        this.inventory.createQueryBuilder('i')
          .select('COALESCE(SUM(i.quantity * COALESCE(i.costPrice, i.sellingPrice, 0)), 0)::float', 'total')
          .where('i.pharmacyTenantId = :t', { t: tenantId })
          .andWhere('i.deletedAt IS NULL')
          .andWhere('i.expiryDate IS NOT NULL')
          .andWhere('i.expiryDate >= :n', { n: now })
          .andWhere('i.expiryDate <= :f180', { f180: in180d })
          .andWhere('i.quantity > 0')
          .getRawOne<{ total: number }>(),
      ]);

    // Approval queue ------------------------------------------------------
    const [pendingByStatusPriority, byAgentRaw, top] = await Promise.all([
      this.approvals.createQueryBuilder('a')
        .select('a.priority', 'priority')
        .addSelect('COUNT(*)::int', 'n')
        .where('a.tenantId = :t', { t: tenantId })
        .andWhere('a.status = :s', { s: 'pending' })
        .groupBy('a.priority')
        .getRawMany<{ priority: string; n: number }>(),
      this.approvals.createQueryBuilder('a')
        .select('a.agentCode', 'agentCode')
        .addSelect('COUNT(*)::int', 'count')
        .where('a.tenantId = :t', { t: tenantId })
        .andWhere('a.status = :s', { s: 'pending' })
        .groupBy('a.agentCode')
        .getRawMany<{ agentCode: string; count: number }>(),
      this.approvals.find({
        where: { tenantId, status: 'pending' as any },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
    ]);

    const priorityCount: Record<string, number> = {};
    let pendingTotal = 0;
    for (const r of pendingByStatusPriority) {
      priorityCount[r.priority] = r.n;
      pendingTotal += r.n;
    }

    const widgets: DashboardWidget[] = [
      {
        key: 'stock_risk',
        titleAr: 'مخزون يوشك على النفاد',
        titleEn: 'Low stock',
        count: stockRisk,
        severity: stockRisk > 0 ? 'warning' : 'success',
        iconKey: 'trending-down',
        deepLink: '/pharmacy/inventory?linkStatus=all&filter=low',
        emptyMessageAr: 'كل المنتجات بمستويات آمنة',
      },
      {
        key: 'out_of_stock',
        titleAr: 'منتجات نفدت',
        titleEn: 'Out of stock',
        count: outOfStock,
        severity: outOfStock > 0 ? 'danger' : 'success',
        iconKey: 'x-circle',
        deepLink: '/pharmacy/inventory',
        emptyMessageAr: 'لا توجد منتجات نافدة',
      },
      {
        key: 'expired',
        titleAr: 'منتهية الصلاحية',
        titleEn: 'Expired',
        count: expired,
        severity: expired > 0 ? 'danger' : 'success',
        iconKey: 'alert-octagon',
        deepLink: '/pharmacy/inventory',
        emptyMessageAr: 'لا توجد منتجات منتهية',
      },
      {
        key: 'near_expiry',
        titleAr: 'تقترب من الانتهاء',
        titleEn: 'Near expiry',
        count: nearExpiry,
        severity: nearExpiry > 0 ? 'warning' : 'info',
        iconKey: 'clock',
        deepLink: '/pharmacy/ai-center?tab=tasks&task=expiry_clearance',
        emptyMessageAr: 'لا توجد دفعات قريبة الانتهاء',
      },
      {
        key: 'dead_stock',
        titleAr: 'مخزون راكد',
        titleEn: 'Dead stock',
        count: deadStock,
        severity: deadStock > 0 ? 'warning' : 'info',
        iconKey: 'archive',
        deepLink: '/pharmacy/inventory',
        emptyMessageAr: 'لا يوجد مخزون راكد',
      },
      {
        key: 'catalog_issues',
        titleAr: 'منتجات بحاجة لربط',
        titleEn: 'Catalog issues',
        count: catalogIssues,
        severity: catalogIssues > 0 ? 'info' : 'success',
        iconKey: 'link',
        deepLink: '/pharmacy/inventory?linkStatus=suggested',
        emptyMessageAr: 'الكتالوج مرتبط بالكامل',
      },
      {
        key: 'pending_approvals',
        titleAr: 'بانتظار موافقتك',
        titleEn: 'Pending approvals',
        count: pendingTotal,
        severity: priorityCount.critical
          ? 'danger'
          : priorityCount.high
            ? 'warning'
            : pendingTotal > 0
              ? 'info'
              : 'success',
        iconKey: 'inbox',
        deepLink: '/pharmacy/ai-center/approvals',
        emptyMessageAr: 'لا توجد مهام بانتظار اتخاذ قرار',
      },
    ];

    const expiryRiskEgp = Math.round(Number(expiryRiskRaw?.total ?? 0));

    return {
      generatedAt: now.toISOString(),
      widgets,
      expiryRiskEgp,
      pendingApprovals: {
        total: pendingTotal,
        critical: priorityCount.critical ?? 0,
        high: priorityCount.high ?? 0,
        byAgent: byAgentRaw,
      },
      topApprovals: top.map((a) => ({
        id: a.id,
        title: a.title,
        summary: a.summary,
        priority: a.priority,
        agentCode: a.agentCode,
        confidenceLabel: a.confidenceLabel,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }
}

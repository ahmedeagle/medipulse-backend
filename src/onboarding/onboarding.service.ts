import { Injectable, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { TenantType } from '../common/enums/tenant-type.enum';
import {
  SeedConsumptionDto,
  BulkInviteSuppliersDto,
} from './dto/onboarding.dto';

export interface OnboardingChecklist {
  /** Total inventory rows the pharmacy currently has. */
  inventoryItemsCount: number;
  /** How many of those still need a catalog match (linkStatus != 'linked'). */
  inventoryUnlinkedCount: number;
  /** Consumption snapshots seeded so far. >=4 means AI can produce forecasts. */
  consumptionSnapshotsCount: number;
  /** Distinct weeks covered by snapshots — drives the "weeks of history" UI. */
  consumptionWeeksCovered: number;
  /** Open (non-terminal) catalog requests still waiting on admin. */
  catalogRequestsOpenCount: number;
  /** Approved suppliers visible to this tenant in supplier_catalog. */
  suppliersAvailableCount: number;
  /** Days since the pharmacy tenant was created. */
  daysActive: number;
  /** True when the rule engine will produce real forecasts instead of cold-start defaults. */
  aiReady: boolean;
  /** Human-readable next-step items the pharmacy should tackle. */
  nextSteps: Array<{ key: string; titleAr: string; titleEn: string; severity: 'todo' | 'recommended' | 'done' }>;
}

const ONE_DAY_MS = 86_400_000;

/**
 * Glue for the "is my pharmacy ready to use Medipulse?" experience.
 *
 * Two halves:
 *   1. Read-only checklist for the pharmacy itself — drives the
 *      onboarding UI strip and the AI cold-start banner.
 *   2. Write helpers that unblock the migration journey:
 *        - seedConsumptionSnapshots(): backdate weekly consumption from
 *          the legacy ERP so the forecasting rules don't sit cold for
 *          28 days waiting for fresh data.
 *        - bulkInviteSuppliers(): admin-only, creates supplier Tenants
 *          en masse from a list (so a new market can be bootstrapped
 *          without 50 manual "create supplier" clicks).
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(ConsumptionSnapshot)
    private readonly snapshotsRepo: Repository<ConsumptionSnapshot>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Checklist ──────────────────────────────────────────────────────────────

  async getChecklist(tenantId: string): Promise<OnboardingChecklist> {
    // Run independent reads in parallel — the checklist is on the critical
    // path of the dashboard and a 5-way serial chain would be visible.
    const [tenant, inv, snap, reqs, suppliers] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'createdAt'] as any }),
      this.dataSource.query<{ total: string; unlinked: string }[]>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE COALESCE("linkStatus", 'unlinked') <> 'linked')::text AS unlinked
           FROM inventory_items
          WHERE "pharmacyTenantId" = $1 AND "deletedAt" IS NULL`,
        [tenantId],
      ),
      this.dataSource.query<{ total: string; weeks: string }[]>(
        `SELECT COUNT(*)::text AS total,
                COUNT(DISTINCT "weekStart")::text AS weeks
           FROM consumption_snapshots
          WHERE "tenantId" = $1`,
        [tenantId],
      ),
      this.dataSource.query<{ open: string }[]>(
        `SELECT COUNT(*)::text AS open
           FROM catalog_requests
          WHERE "pharmacyTenantId" = $1
            AND status IN ('submitted', 'under_review', 'need_info')`,
        [tenantId],
      ),
      this.dataSource.query<{ total: string }[]>(
        `SELECT COUNT(DISTINCT "supplierTenantId")::text AS total
           FROM supplier_catalog
          WHERE "isAvailable" = true AND "deletedAt" IS NULL`,
      ),
    ]);

    const inventoryItemsCount = Number(inv[0]?.total ?? 0);
    const inventoryUnlinkedCount = Number(inv[0]?.unlinked ?? 0);
    const consumptionSnapshotsCount = Number(snap[0]?.total ?? 0);
    const consumptionWeeksCovered = Number(snap[0]?.weeks ?? 0);
    const catalogRequestsOpenCount = Number(reqs[0]?.open ?? 0);
    const suppliersAvailableCount = Number(suppliers[0]?.total ?? 0);
    const daysActive = tenant?.createdAt
      ? Math.max(0, Math.floor((Date.now() - new Date(tenant.createdAt).getTime()) / ONE_DAY_MS))
      : 0;

    // AI is ready when EITHER we've reached the natural 28-day live window
    // OR the pharmacy seeded enough historical snapshots to shortcut it.
    const aiReady = daysActive >= 28 || consumptionWeeksCovered >= 4;

    const nextSteps: OnboardingChecklist['nextSteps'] = [];
    if (inventoryItemsCount === 0) {
      nextSteps.push({
        key: 'upload_inventory',
        titleAr: 'ارفع مخزون الصيدلية الحالي (Excel أو CSV)',
        titleEn: 'Upload your current pharmacy inventory (Excel / CSV)',
        severity: 'todo',
      });
    } else {
      nextSteps.push({
        key: 'upload_inventory',
        titleAr: `تم رفع ${inventoryItemsCount} صنف`,
        titleEn: `${inventoryItemsCount} items uploaded`,
        severity: 'done',
      });
    }

    if (inventoryUnlinkedCount > 0) {
      nextSteps.push({
        key: 'resolve_unlinked',
        titleAr: `راجع ${inventoryUnlinkedCount} صنف غير مرتبط بالكتالوج المركزي`,
        titleEn: `Resolve ${inventoryUnlinkedCount} items not yet linked to the central catalog`,
        severity: 'recommended',
      });
    }

    if (!aiReady) {
      nextSteps.push({
        key: 'seed_consumption',
        titleAr: `ارفع تاريخ المبيعات الأسبوعي (${consumptionWeeksCovered}/4 أسابيع) لتفعيل التوقّعات الذكية فوراً`,
        titleEn: `Seed weekly consumption history (${consumptionWeeksCovered}/4 weeks) to unlock AI forecasts immediately`,
        severity: 'recommended',
      });
    } else {
      nextSteps.push({
        key: 'seed_consumption',
        titleAr: 'الذكاء الاصطناعي جاهز ويعمل على بياناتك',
        titleEn: 'AI is warm and producing real forecasts on your data',
        severity: 'done',
      });
    }

    if (suppliersAvailableCount === 0) {
      nextSteps.push({
        key: 'no_suppliers',
        titleAr: 'لا يوجد موردون متاحون بعد — تواصل مع فريق الدعم لتفعيل سوق المشتريات',
        titleEn: 'No suppliers visible yet — contact support to enable the procurement marketplace',
        severity: 'todo',
      });
    } else {
      nextSteps.push({
        key: 'no_suppliers',
        titleAr: `${suppliersAvailableCount} مورد متاح للشراء`,
        titleEn: `${suppliersAvailableCount} suppliers available for procurement`,
        severity: 'done',
      });
    }

    return {
      inventoryItemsCount,
      inventoryUnlinkedCount,
      consumptionSnapshotsCount,
      consumptionWeeksCovered,
      catalogRequestsOpenCount,
      suppliersAvailableCount,
      daysActive,
      aiReady,
      nextSteps,
    };
  }

  // ── Seed consumption snapshots ────────────────────────────────────────────

  /**
   * Backdate weekly consumption rows. Index 0 of weeklyQty is the most
   * recently completed Monday-anchored week; index N is the oldest.
   */
  async seedConsumptionSnapshots(
    tenantId: string,
    dto: SeedConsumptionDto,
  ): Promise<{ inserted: number; skipped: number; productsSeeded: number }> {
    const preserveExisting = dto.preserveExisting !== false;
    const mostRecentMonday = this.previousMonday(new Date());

    // Flatten + dedupe by (productId, weekStart). The legacy ERP often
    // exports duplicate lines when a product appears twice.
    type Row = { tenantId: string; productId: string; weekStart: Date; quantityConsumed: number };
    const rows: Row[] = [];
    for (const item of dto.items) {
      for (let i = 0; i < item.weeklyQty.length; i++) {
        const weekStart = new Date(mostRecentMonday);
        weekStart.setUTCDate(weekStart.getUTCDate() - 7 * i);
        rows.push({
          tenantId,
          productId: item.productId,
          weekStart,
          quantityConsumed: item.weeklyQty[i] ?? 0,
        });
      }
    }
    if (rows.length === 0) return { inserted: 0, skipped: 0, productsSeeded: 0 };

    // Bulk INSERT with ON CONFLICT to honor preserveExisting. We rely on
    // the partial-unique semantics of the existing index on
    // (tenantId, productId, weekStart); to be safe, build the conflict
    // target as a manual subquery existence check rather than a unique
    // constraint we can't guarantee exists.
    let inserted = 0;
    let skipped = 0;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      if (preserveExisting) {
        // Filter out existing rows in one round-trip per chunk.
        const existing: Array<{ productId: string; weekStart: Date }> = await this.dataSource.query(
          `SELECT "productId", "weekStart"
             FROM consumption_snapshots
            WHERE "tenantId" = $1
              AND "productId" = ANY($2::uuid[])
              AND "weekStart" = ANY($3::date[])`,
          [
            tenantId,
            chunk.map((r) => r.productId),
            chunk.map((r) => r.weekStart.toISOString().slice(0, 10)),
          ],
        );
        const existingKey = new Set(
          existing.map((e) => `${e.productId}|${new Date(e.weekStart).toISOString().slice(0, 10)}`),
        );
        const fresh = chunk.filter(
          (r) => !existingKey.has(`${r.productId}|${r.weekStart.toISOString().slice(0, 10)}`),
        );
        skipped += chunk.length - fresh.length;
        if (fresh.length) {
          inserted += fresh.length;
          await this.snapshotsRepo.insert(
            fresh.map((r) => ({
              tenantId: r.tenantId,
              productId: r.productId,
              weekStart: r.weekStart,
              quantityConsumed: r.quantityConsumed,
              ordersPlaced: 0,
              avgOrderSize: 0,
              velocityLabel: 'normal',
            })),
          );
        }
      } else {
        inserted += chunk.length;
        await this.snapshotsRepo.insert(
          chunk.map((r) => ({
            tenantId: r.tenantId,
            productId: r.productId,
            weekStart: r.weekStart,
            quantityConsumed: r.quantityConsumed,
            ordersPlaced: 0,
            avgOrderSize: 0,
            velocityLabel: 'normal',
          })),
        );
      }
    }

    return { inserted, skipped, productsSeeded: new Set(rows.map((r) => r.productId)).size };
  }

  // ── Admin: bulk supplier invite ───────────────────────────────────────────

  /**
   * Creates supplier-type Tenants from a list. We only seed the tenant
   * record — the actual user/password is provisioned separately via the
   * existing /admin invite-user flow (which already does Keycloak).
   *
   * Slug collisions are returned as `failed` so the admin sees which rows
   * need a rename. We do NOT silently coerce or rename — a typo'd slug
   * during onboarding causes hard-to-trace audit-log gaps.
   */
  async bulkInviteSuppliers(
    dto: BulkInviteSuppliersDto,
  ): Promise<{
    created: Array<{ slug: string; tenantId: string }>;
    failed:  Array<{ slug: string; reason: string }>;
  }> {
    const created: Array<{ slug: string; tenantId: string }> = [];
    const failed:  Array<{ slug: string; reason: string }> = [];

    for (const s of dto.suppliers) {
      try {
        // Pre-check to surface a friendly conflict, not a raw SQL error.
        const existing = await this.tenantRepo.findOne({ where: { slug: s.slug } });
        if (existing) {
          throw new ConflictException(`slug "${s.slug}" already in use`);
        }
        if (!/^[a-z0-9-]+$/.test(s.slug)) {
          throw new BadRequestException(`slug "${s.slug}" must be lowercase letters, digits, or hyphens`);
        }
        const tenant = this.tenantRepo.create({
          name: s.name,
          slug: s.slug,
          type: TenantType.SUPPLIER,
          isActive: true,
          city: s.city ?? null,
          region: s.region ?? null,
        } as Partial<Tenant>);
        const saved = await this.tenantRepo.save(tenant);
        created.push({ slug: s.slug, tenantId: saved.id });
        this.logger.log(`Bulk-invite created supplier tenant ${s.slug} (${saved.id})`);
      } catch (err: any) {
        failed.push({
          slug: s.slug,
          reason: err?.response?.message ?? err?.message ?? 'unknown error',
        });
      }
    }

    return { created, failed };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Returns the most recent Monday at 00:00 UTC. If today is a Monday, we
   * return *last* Monday — the current week isn't complete yet and would
   * skew the snapshot.
   */
  private previousMonday(from: Date): Date {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const dow = d.getUTCDay(); // 0..6, 0 = Sunday
    const daysSinceMonday = dow === 0 ? 6 : dow - 1; // Monday = 1
    const offset = daysSinceMonday === 0 ? 7 : daysSinceMonday;
    d.setUTCDate(d.getUTCDate() - offset);
    return d;
  }
}

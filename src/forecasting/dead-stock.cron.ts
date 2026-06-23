import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DeadStockService } from '../inventory/dead-stock.service';
import { NotificationService } from '../notifications/notification.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';
import { ApprovalService } from '../ai-governance/approval.service';
import { Tenant } from '../auth/entities/tenant.entity';

@Injectable()
export class DeadStockCron {
  private readonly logger = new Logger(DeadStockCron.name);

  constructor(
    private readonly deadStockService: DeadStockService,
    private readonly notificationService: NotificationService,
    private readonly pharmacySettings: PharmacySettingsService,
    private readonly cronLock: CronLockService,
    @Inject(forwardRef(() => ApprovalService))
    private readonly approvals: ApprovalService,
    private readonly dataSource: DataSource,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  // Runs every day at 2:00 AM UTC
  @Cron('0 2 * * *')
  async scanDeadStock() {
    const acquired = await this.cronLock.acquire('dead_stock_daily');
    if (!acquired) {
      this.logger.log('DeadStockCron: skipped (another pod holds the lock)');
      return;
    }

    this.logger.log('Running dead stock scan across all tenants...');

    const rows = await this.tenantRepo
      .createQueryBuilder('t')
      .select('t.id', 'id')
      .where("t.type = 'pharmacy'")
      .getRawMany<{ id: string }>();
    const tenants = rows.map((r) => r.id);

    for (const tenantId of tenants) {
      try {
        const settings = await this.pharmacySettings.getSettings(tenantId);
        if (!await this.pharmacySettings.getNotifFlag(tenantId, 'enableDeadStockAlerts')) continue;

        const analyses = await this.deadStockService.analyzeDeadStock(tenantId);
        const critical = analyses.filter((a) => a.urgencyScore >= 70);
        if (critical.length === 0) continue;

        // Per-item approval tasks
        for (const analysis of critical) {
          try {
            await this.createDeadStockApprovalTask(tenantId, analysis);
          } catch (err: any) {
            this.logger.error(
              `DeadStockCron: failed to create task for product ${analysis.productId} ` +
              `in tenant ${tenantId}: ${err.message}`,
            );
          }
        }

        // Weekly digest notification (kept for summary visibility)
        const weekAgo = new Date(Date.now() - 7 * 86_400_000);
        const recentAlert = await this.notificationService.findRecentDeadStockAlert(tenantId, weekAgo);
        if (recentAlert) continue;

        const totalValue = critical.reduce((s, a) => s + a.estimatedValue, 0);
        const names = critical
          .slice(0, 3)
          .map((a) => a.productName)
          .join('، ');

        await this.notificationService.create({
          tenantId,
          type: 'dead_stock',
          title: `📦 ${critical.length} منتج راكد يستنزف ${Math.round(totalValue).toLocaleString()} ${settings.currency}`,
          body: `${names}${critical.length > 3 ? ` و${critical.length - 3} آخرين` : ''} — لم تتحرك لفترة طويلة. راجعها في مركز الذكاء`,
          resourceRef: '/pharmacy/ai-center?tab=tasks&task=dead_stock',
        });

        this.logger.log(`Sent dead-stock alert to tenant ${tenantId}: ${critical.length} items, value=${totalValue}`);
      } catch (err) {
        this.logger.error(`Dead stock scan failed for tenant ${tenantId}: ${err.message}`);
      }
    }
  }

  private async createDeadStockApprovalTask(
    tenantId: string,
    analysis: Awaited<ReturnType<DeadStockService['analyzeDeadStock']>>[number],
  ): Promise<void> {
    // Resolve inventoryItemId from (tenantId, productId)
    const [item] = await this.dataSource.query<{
      id: string;
      costPrice: string | null;
      sellingPrice: string | null;
    }[]>(
      `SELECT id, "costPrice", "sellingPrice"
       FROM inventory_items
       WHERE "pharmacyTenantId" = $1
         AND "productId" = $2
         AND "deletedAt" IS NULL
       LIMIT 1`,
      [tenantId, analysis.productId],
    );

    if (!item) return; // item was deleted between analyzeDeadStock and now

    // Per-item dedup: skip if a pending/modified task already exists
    const [existing] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM approvals
       WHERE "subjectType" = 'dead_stock_clearance'
         AND "subjectId"   = $1
         AND status IN ('pending', 'modified')
       LIMIT 1`,
      [item.id],
    );
    if (existing) return;

    const suggestedDiscountPct = analysis.urgencyScore >= 90 ? 40 : 25;
    const costPrice    = parseFloat(item.costPrice    ?? '0') || 0;
    const sellingPrice = parseFloat(item.sellingPrice ?? '0') || 0;

    const priority: 'critical' | 'high' | 'medium' =
      analysis.urgencyScore >= 90 ? 'critical' :
      analysis.urgencyScore >= 80 ? 'high'     : 'medium';

    const weeks = analysis.weeksWithoutMovement;

    await this.approvals.create(tenantId, {
      agentCode:        'dead_stock_expert',
      subjectType:      'dead_stock_clearance',
      subjectId:        item.id,
      title:            `مخزون راكد: ${analysis.productName}`,
      summary:          `${analysis.currentQuantity} وحدة لم تتحرك منذ ${weeks} أسبوع — نسبة الخطر ${Math.round(analysis.deadStockProbability * 100)}%`,
      rationale:
        `المنتج محلل بالذكاء الاصطناعي: احتمال تحوّله لمخزون ميت ${Math.round(analysis.deadStockProbability * 100)}%. ` +
        `الإجراء الموصى به: ${this.actionLabel(analysis.recommendedAction)}. ` +
        `عند الموافقة سيُدرج في سوق التبادل بخصم ${suggestedDiscountPct}%.`,
      confidence:       analysis.deadStockProbability,
      confidenceReason: analysis.actionReason,
      priority,
      payload: {
        inventoryItemId:      item.id,
        productId:            analysis.productId,
        productName:          analysis.productName,
        quantity:             analysis.currentQuantity,
        urgencyScore:         analysis.urgencyScore,
        deadStockProbability: analysis.deadStockProbability,
        recommendedAction:    analysis.recommendedAction,
        suggestedDiscountPct,
        sellingPrice,
        costPrice,
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
  }

  private actionLabel(action: string): string {
    switch (action) {
      case 'return_to_supplier': return 'إرجاع للمورد';
      case 'markdown':           return 'تخفيض السعر';
      case 'write_off':          return 'شطب';
      default:                   return 'مراقبة';
    }
  }
}

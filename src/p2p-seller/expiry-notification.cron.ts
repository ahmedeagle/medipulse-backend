import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, IsNull } from 'typeorm';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { NotificationService } from '../notifications/notification.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

@Injectable()
export class ExpiryNotificationCron {
  private readonly logger = new Logger(ExpiryNotificationCron.name);

  constructor(
    @InjectRepository(InventoryItem)
    private readonly invRepo: Repository<InventoryItem>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly notificationService: NotificationService,
    private readonly pharmacySettingsService: PharmacySettingsService,
    private readonly cronLock: CronLockService,
  ) {}

  // Runs every day at 7:30 AM UTC
  @Cron('30 7 * * *')
  async sendDailyExpiryDigests() {
    const acquired = await this.cronLock.acquire('expiry_digest_daily');
    if (!acquired) {
      this.logger.log('ExpiryNotificationCron: digest skipped (another pod holds the lock)');
      return;
    }

    this.logger.log('Running daily expiry digest scan...');

    const now = new Date();
    // Use 365 days as broad upper bound — per-tenant expiryAlertDays applied in the loop below
    const broadHorizon = new Date();
    broadHorizon.setDate(broadHorizon.getDate() + 365);

    // Find all distinct tenants that have near-expiry items (broad pass)
    const rows = await this.invRepo
      .createQueryBuilder('inv')
      .select('inv."pharmacyTenantId"', 'tenantId')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN inv."expiryDate" <= :critical THEN 1 ELSE 0 END)`,
        'criticalCount',
      )
      .addSelect(
        `SUM(CASE WHEN inv."expiryDate" > :critical AND inv."expiryDate" <= :high THEN 1 ELSE 0 END)`,
        'highCount',
      )
      .where('inv."expiryDate" IS NOT NULL')
      .andWhere('inv."expiryDate" >= :today', { today: now.toISOString().slice(0, 10) })
      .andWhere('inv."expiryDate" <= :horizon', { horizon: broadHorizon })
      .andWhere('inv.quantity > 0')
      .andWhere('inv."deletedAt" IS NULL')
      .setParameter('critical', this.daysFromNow(30))
      .setParameter('high', this.daysFromNow(60))
      .groupBy('inv."pharmacyTenantId"')
      .getRawMany<{ tenantId: string; total: string; criticalCount: string; highCount: string }>();

    this.logger.log(`Found ${rows.length} tenant(s) with expiring items`);

    const todayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const todayStart = new Date(`${todayKey}T00:00:00.000Z`);

    for (const row of rows) {
      // Respect this tenant's configured expiryAlertDays — skip if total is 0 after filtering
      const tenantSettings = await this.pharmacySettingsService.getSettings(row.tenantId);
      if (tenantSettings.aiAnalysisSettings?.enableExpiryProtection === false) continue;
      const alertDays = tenantSettings.inventorySettings?.expiryAlertDays ?? 90;
      const alertCutoff = this.daysFromNow(alertDays);

      // Re-count using this tenant's threshold (the SQL used 365 days as a broad pass)
      const tenantItems = await this.invRepo
        .createQueryBuilder('inv')
        .where('inv."pharmacyTenantId" = :tenantId', { tenantId: row.tenantId })
        .andWhere('inv."expiryDate" IS NOT NULL')
        .andWhere('inv."expiryDate" >= :today', { today: now.toISOString().slice(0, 10) })
        .andWhere('inv."expiryDate" <= :cutoff', { cutoff: alertCutoff })
        .andWhere('inv.quantity > 0')
        .andWhere('inv."deletedAt" IS NULL')
        .getCount();

      if (tenantItems === 0) continue;

      const total = tenantItems;
      const critical = parseInt(row.criticalCount, 10);
      const high = parseInt(row.highCount, 10);
      const urgent = critical + high;

      // Deduplicate: don't send more than one digest per tenant per calendar day
      const alreadySent = await this.notificationService.findTodayDigest(row.tenantId, todayStart);
      if (alreadySent) continue;

      const titleAr = urgent > 0
        ? `⚠️ ${urgent} منتج يحتاج إجراء فوري`
        : `تنبيه انتهاء صلاحية — ${total} منتج`;

      await this.notificationService.create({
        tenantId: row.tenantId,
        type: 'expiry_digest',
        title: titleAr,
        body: this.buildBodyAr(total, critical, high),
        resourceRef: '/pharmacy/ai-center?tab=tasks&task=expiry_clearance',
      });

      this.logger.log(`Sent expiry digest to tenant ${row.tenantId}: ${total} items (${critical} critical, ${high} high)`);
    }
  }

  // Fire an immediate notification when a single item is within the tenant's expiryAlertDays threshold.
  // Runs every 6 hours so newly added items with close expiry get flagged within hours.
  @Cron('0 */6 * * *')
  async sendCriticalItemAlerts() {
    const acquired = await this.cronLock.acquire('expiry_critical_6h', 21600);
    if (!acquired) {
      this.logger.log('ExpiryNotificationCron: critical alerts skipped (another pod holds the lock)');
      return;
    }
    // Use 365 days as a broad upper bound — per-tenant threshold applied below
    const broadThreshold = this.daysFromNow(365);
    const today = new Date().toISOString().slice(0, 10);

    const items = await this.invRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.product', 'product')
      .where('inv."expiryDate" IS NOT NULL')
      .andWhere('inv."expiryDate" >= :today', { today })
      .andWhere('inv."expiryDate" <= :threshold', { threshold: broadThreshold })
      .andWhere('inv.quantity > 0')
      .andWhere('inv."deletedAt" IS NULL')
      .getMany();

    // Group by tenant so we do one settings lookup per tenant, not per item
    const byTenant = new Map<string, InventoryItem[]>();
    for (const item of items) {
      const group = byTenant.get(item.pharmacyTenantId) ?? [];
      group.push(item);
      byTenant.set(item.pharmacyTenantId, group);
    }

    for (const [tenantId, tenantItems] of byTenant) {
      const settings = await this.pharmacySettingsService.getSettings(tenantId);
      if (settings.aiAnalysisSettings?.enableExpiryProtection === false) continue;
      const alertDays = settings.inventorySettings?.expiryAlertDays ?? 90;
      const alertCutoff = Date.now() + alertDays * 86_400_000;

      for (const item of tenantItems) {
        const expiryTime = new Date(item.expiryDate).getTime();
        if (expiryTime > alertCutoff) continue; // beyond this tenant's configured alert window

        const daysLeft = Math.floor((expiryTime - Date.now()) / 86_400_000);
        const aiCenterRef = `/pharmacy/ai-center?tab=tasks&task=expiry_clearance`;

        // Dedup: skip if we already sent a near_expiry alert for this item within 72 hours
        const existing = await this.notificationService.findByResourceRef(
          aiCenterRef, tenantId,
        );
        if (existing && (Date.now() - existing.createdAt.getTime()) < 72 * 3_600_000) continue;

        const productNameAr = (item as any).product?.nameAr ?? (item as any).product?.name ?? 'Unknown product';

        await this.notificationService.create({
          tenantId,
          type: 'near_expiry',
          title: `${productNameAr} — ${daysLeft} يوم للانتهاء`,
          body: `الكمية: ${item.quantity} وحدة — مركز الذكاء أنشأ مهمة تصفية تلقائية، راجعها وأقرّها`,
          resourceRef: aiCenterRef,
        });
      }
    }
  }

  private daysFromNow(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }

  private buildBodyAr(total: number, critical: number, high: number): string {
    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} منتج حرج (أقل من 30 يوم)`);
    if (high > 0) parts.push(`${high} منتج عالٍ (30-60 يوم)`);
    const rest = total - critical - high;
    if (rest > 0) parts.push(`${rest} منتج متوسط/منخفض`);
    return `لديك ${total} منتج تنتهي صلاحيتهم قريباً: ${parts.join('، ')}. اذهب إلى البيع للصيدليات لإدراجهم.`;
  }

  private buildBodyEn(total: number, critical: number, high: number): string {
    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} critical (<30d)`);
    if (high > 0) parts.push(`${high} high (30-60d)`);
    const rest = total - critical - high;
    if (rest > 0) parts.push(`${rest} medium/low`);
    return `${total} items expiring soon: ${parts.join(', ')}. Go to P2P Sell tab to list them.`;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Tenant } from '../auth/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { NotificationService } from '../notifications/notification.service';
import { DashboardService } from './dashboard.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';

/**
 * Morning Briefing (PRD v2 §14).
 *
 * Every weekday at 07:00 server time, generates one in-app notification per
 * active pharmacy tenant summarising what its AI workforce noticed overnight.
 *
 * Targets pharmacy_admin users; deep-links to /pharmacy/ai-center.
 */
@Injectable()
export class BriefingScheduler {
  private readonly logger = new Logger(BriefingScheduler.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(User)   private readonly users:   Repository<User>,
    private readonly dashboard:     DashboardService,
    private readonly notifications: NotificationService,
    private readonly cronLock:      CronLockService,
    private readonly settingsSvc:   PharmacySettingsService,
  ) {}

  @Cron('0 7 * * 1-6', { name: 'ai-morning-briefing' })
  async runDaily(): Promise<void> {
    const acquired = await this.cronLock.acquire('morning_briefing_daily');
    if (!acquired) {
      this.logger.log('BriefingScheduler: skipped (another pod holds the lock)');
      return;
    }

    const active = await this.tenants.find({ where: { isActive: true } });
    this.logger.log(`Morning briefing sweep: ${active.length} tenants`);
    for (const tenant of active) {
      try { await this.briefTenant(tenant.id); }
      catch (err) {
        this.logger.error(`briefing failed for ${tenant.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Public for manual trigger / testing. */
  async briefTenant(tenantId: string): Promise<void> {
    const summary = await this.dashboard.summary(tenantId);

    // Skip silent days when there is genuinely nothing to mention.
    const widgetTotal = summary.widgets.reduce((s, w) => s + w.count, 0);
    if (widgetTotal === 0 && summary.pendingApprovals.total === 0) return;

    const recipients = await this.users.find({
      where: { tenantId, role: Role.PHARMACY_ADMIN },
    });
    if (recipients.length === 0) return;

    const { title, body } = formatBriefingAr(summary);

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const briefingEnabled = await this.settingsSvc.getNotifFlag(tenantId, 'enableMorningBriefing');

    for (const u of recipients) {
      const alreadySent = await this.notifications.findRecentByTypeForUser(
        tenantId, u.id, 'morning_briefing', todayStart,
      );
      if (alreadySent) continue;

      if (briefingEnabled) {
        await this.notifications.create({
          tenantId,
          userId:      u.id,
          type:        'morning_briefing',
          title,
          body,
          resourceRef: '/pharmacy/ai-center',
        });
      }
    }
  }
}

function formatBriefingAr(summary: Awaited<ReturnType<DashboardService['summary']>>): { title: string; body: string } {
  const lines: string[] = [];
  for (const w of summary.widgets) {
    if (w.count > 0) lines.push(`• ${w.titleAr}: ${w.count}`);
  }
  if (summary.pendingApprovals.total > 0) {
    lines.push(`• قرارات بانتظارك: ${summary.pendingApprovals.total}${
      summary.pendingApprovals.critical ? ` (منها ${summary.pendingApprovals.critical} حرج)` : ''
    }`);
  }
  const title = 'موجز الصباح من مساعديك الأذكياء';
  const body  = lines.length
    ? `إليك ما رصده مساعدوك منذ آخر زيارة:\n\n${lines.join('\n')}\n\nافتح مركز الذكاء لاتخاذ القرارات.`
    : 'كل المؤشرات هادئة هذا الصباح. تابع يومك بثقة.';
  return { title, body };
}

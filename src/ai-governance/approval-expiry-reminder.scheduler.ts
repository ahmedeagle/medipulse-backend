import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

import { User } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { NotificationService } from '../notifications/notification.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';
import { Approval } from './entities/approval.entity';

const DEEP_LINK = '/pharmacy/ai-center?tab=approvals';

interface TenantExpiry {
  tenantId: string;
  total: number;
  critical: number;
  soonest: string; // ISO
}

/**
 * ApprovalExpiryReminder — the anti-miss safety net (AI Center §14).
 *
 * The existing scheduler silently flips overdue approvals to `expired`. This
 * job runs *ahead* of that: once an hour it finds pending/modified approvals
 * whose `expiresAt` falls inside the next 24h (2h emphasis for critical ones)
 * and sends ONE coalesced notification per tenant to its pharmacy admins so a
 * decision never lapses unseen. Dedup + cron-lock keep it single-fire and
 * spam-free even across multiple pods.
 */
@Injectable()
export class ApprovalExpiryReminderScheduler {
  private readonly logger = new Logger(ApprovalExpiryReminderScheduler.name);

  constructor(
    @InjectRepository(Approval) private readonly approvals: Repository<Approval>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly notifications: NotificationService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'approval-expiry-reminder' })
  async run(): Promise<void> {
    const acquired = await this.cronLock.acquire('approval_expiry_reminder', 1800);
    if (!acquired) {
      this.logger.log('ApprovalExpiryReminder: skipped (lock held elsewhere)');
      return;
    }

    const rows = await this.approvals
      .createQueryBuilder('a')
      .select('a."tenantId"', 'tenantId')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE a."priority" = 'critical' AND a."expiresAt" < now() + interval '2 hours')`, 'critical')
      .addSelect('MIN(a."expiresAt")', 'soonest')
      .where(`a."status" IN ('pending','modified')`)
      .andWhere('a."expiresAt" IS NOT NULL')
      .andWhere('a."expiresAt" > now()')
      .andWhere(`a."expiresAt" < now() + interval '24 hours'`)
      .groupBy('a."tenantId"')
      .getRawMany<{ tenantId: string; total: string; critical: string; soonest: string }>();

    if (rows.length === 0) return;
    this.logger.log(`ApprovalExpiryReminder: ${rows.length} tenant(s) with imminent expiries`);

    for (const row of rows) {
      try {
        await this.remindTenant({
          tenantId: row.tenantId,
          total: Number(row.total),
          critical: Number(row.critical),
          soonest: row.soonest,
        });
      } catch (err) {
        this.logger.error(`reminder failed for ${row.tenantId}: ${(err as Error).message}`);
      }
    }
  }

  private async remindTenant(x: TenantExpiry): Promise<void> {
    const admins = await this.users.find({
      where: { tenantId: x.tenantId, role: Role.PHARMACY_ADMIN },
    });
    if (admins.length === 0) return;

    const soonestHrs = Math.max(1, Math.round((new Date(x.soonest).getTime() - Date.now()) / 3_600_000));
    const title = `عندك ${x.total} إجراء هيفوتك خلال ${soonestHrs} ساعة`;
    const critNote = x.critical > 0 ? ` منها ${x.critical} حرج لازم دلوقتي.` : '';
    const body =
      `${x.total} قرار من مساعديك الأذكياء بانتظار موافقتك وقربوا يخلص وقتهم.${critNote}` +
      ` افتح مركز الذكاء واعتمدهم قبل ما يضيعوا.`;

    for (const u of admins) {
      await this.notifications.create({
        tenantId: x.tenantId,
        userId: u.id,
        type: 'approval_expiring',
        title,
        body,
        resourceRef: DEEP_LINK,
        dedupeWindowMs: 3 * 60 * 60 * 1000, // ≤ 1 reminder per admin per 3h
        dedupeBy: 'resourceRef',
      });
    }
  }
}

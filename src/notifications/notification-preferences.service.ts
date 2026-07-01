import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationSeverity, NotificationChannel } from './notification-policy';

export interface UpsertNotificationPreferencesInput {
  inApp?: boolean;
  email?: boolean;
  whatsapp?: boolean;
  push?: boolean;
  allowLow?: boolean;
  allowMedium?: boolean;
  allowHigh?: boolean;
  allowCritical?: boolean;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  quietHoursTimezone?: string;
}

/** Safe defaults when a tenant has never configured preferences. */
export const DEFAULT_PREFERENCES = {
  inApp: true,
  email: true,
  whatsapp: false,   // opt-in only
  push: false,       // opt-in only
  allowLow: true,
  allowMedium: true,
  allowHigh: true,
  allowCritical: true,
  quietHoursStart: null as number | null,
  quietHoursEnd: null as number | null,
  quietHoursTimezone: 'Africa/Cairo',
};

export type EffectivePreference = typeof DEFAULT_PREFERENCES;

/**
 * The Preference Filter: owns per-tenant delivery preferences and the rule engine
 * that turns a notification's *intended* channels into the *effective* channels a
 * given tenant actually allows. In-app is always kept (never lost); external
 * channels (push/WhatsApp) are opt-in, severity-gated, and quiet-hours-aware.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly repo: Repository<NotificationPreference>,
  ) {}

  /** The tenant-wide default row (userId IS NULL), or safe defaults if unset. */
  async getTenantDefault(tenantId: string): Promise<EffectivePreference> {
    const row = await this.repo.findOne({
      where: { pharmacyTenantId: tenantId, userId: null as any },
    });
    return row ? this.toEffective(row) : { ...DEFAULT_PREFERENCES };
  }

  /** Upsert the tenant-wide default preferences. */
  async upsertTenantDefault(
    tenantId: string,
    input: UpsertNotificationPreferencesInput,
  ): Promise<EffectivePreference> {
    let row = await this.repo.findOne({
      where: { pharmacyTenantId: tenantId, userId: null as any },
    });
    if (!row) {
      row = this.repo.create({ pharmacyTenantId: tenantId, userId: null, ...DEFAULT_PREFERENCES });
    }
    Object.assign(row, this.sanitize(input));
    const saved = await this.repo.save(row);
    return this.toEffective(saved);
  }

  /**
   * Resolve the effective preference for a delivery: a user-specific row wins,
   * else the tenant default, else safe defaults. One indexed lookup.
   */
  async resolve(tenantId: string, userId: string | null): Promise<EffectivePreference> {
    const rows = await this.repo
      .createQueryBuilder('p')
      .where('p.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('(p.userId = :userId OR p.userId IS NULL)', { userId: userId ?? null })
      .orderBy('p.userId', 'DESC', 'NULLS LAST') // user-specific first
      .limit(1)
      .getOne();
    return rows ? this.toEffective(rows) : { ...DEFAULT_PREFERENCES };
  }

  /**
   * Rule engine. Given the notification's severity + intended channels and the
   * resolved preference, return the channels that may actually be delivered.
   *   • in_app / dashboard are always kept (reliability — never silently dropped).
   *   • push/whatsapp require the channel opt-in AND the severity to be allowed.
   *   • during quiet hours, non-critical push/whatsapp are suppressed.
   */
  applyFilter(
    severity: NotificationSeverity,
    intended: NotificationChannel[],
    pref: EffectivePreference,
    now: Date = new Date(),
  ): NotificationChannel[] {
    const keep = new Set<NotificationChannel>();
    if (intended.includes('dashboard')) keep.add('dashboard');
    keep.add('in_app'); // always reachable in the app

    const severityAllowed = this.severityAllowed(severity, pref);
    const quiet = this.inQuietHours(pref, now);

    for (const ch of ['push', 'whatsapp'] as const) {
      if (!intended.includes(ch)) continue;
      if (!severityAllowed) continue;
      if (ch === 'push' && !pref.push) continue;
      if (ch === 'whatsapp' && !pref.whatsapp) continue;
      if (quiet && severity !== 'critical') continue;
      keep.add(ch);
    }
    return [...keep];
  }

  private severityAllowed(severity: NotificationSeverity, pref: EffectivePreference): boolean {
    switch (severity) {
      case 'low':      return pref.allowLow;
      case 'medium':   return pref.allowMedium;
      case 'high':     return pref.allowHigh;
      case 'critical': return pref.allowCritical;
      default:         return true;
    }
  }

  private inQuietHours(pref: EffectivePreference, now: Date): boolean {
    const { quietHoursStart: start, quietHoursEnd: end } = pref;
    if (start == null || end == null || start === end) return false;
    const nowMin = this.minutesInTimezone(now, pref.quietHoursTimezone);
    return start < end
      ? nowMin >= start && nowMin < end          // same-day window
      : nowMin >= start || nowMin < end;          // overnight window
  }

  private minutesInTimezone(now: Date, timeZone: string): number {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(now);
      let h = 0, m = 0;
      for (const p of parts) {
        if (p.type === 'hour') h = Number(p.value) % 24;
        if (p.type === 'minute') m = Number(p.value);
      }
      return h * 60 + m;
    } catch {
      return now.getUTCHours() * 60 + now.getUTCMinutes();
    }
  }

  private toEffective(row: NotificationPreference): EffectivePreference {
    return {
      inApp: row.inApp,
      email: row.email,
      whatsapp: row.whatsapp,
      push: row.push,
      allowLow: row.allowLow,
      allowMedium: row.allowMedium,
      allowHigh: row.allowHigh,
      allowCritical: row.allowCritical,
      quietHoursStart: row.quietHoursStart,
      quietHoursEnd: row.quietHoursEnd,
      quietHoursTimezone: row.quietHoursTimezone,
    };
  }

  /** Clamp quiet-hours minutes to [0,1439] and drop unknown keys. */
  private sanitize(input: UpsertNotificationPreferencesInput): UpsertNotificationPreferencesInput {
    const clamp = (v: number | null | undefined): number | null | undefined =>
      v == null ? v : Math.max(0, Math.min(1439, Math.round(v)));
    return {
      ...input,
      quietHoursStart: clamp(input.quietHoursStart),
      quietHoursEnd: clamp(input.quietHoursEnd),
    };
  }
}

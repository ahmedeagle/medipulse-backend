import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UsageCounter } from './entities/usage-counter.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { Notification } from '../notifications/entities/notification.entity';
import {
  PlanTier, MeteredResource, capFor, currentPeriod,
} from './plan-caps';

export interface UsageCheck {
  allowed: boolean;
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null;
}

export interface UsageSummary {
  period: string;
  planTier: PlanTier;
  ai: UsageCheck;
  whatsapp: UsageCheck;
}

/**
 * Meters and enforces the two cost-bearing resources (AI assistant + WhatsApp)
 * against the tenant's plan caps. Cheap: one indexed read + one atomic upsert.
 * When a cap is hit it raises an in-app "credits finished" notification (once per
 * month per resource) so the pharmacy is aware — matching what the pricing page
 * promises.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @InjectRepository(UsageCounter)
    private readonly counters: Repository<UsageCounter>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  private async planOf(tenantId: string): Promise<PlanTier> {
    const t = await this.tenants.findOne({ where: { id: tenantId }, select: ['id', 'planTier'] });
    return (t?.planTier as PlanTier) ?? 'free';
  }

  private async countersOf(tenantId: string, period: string): Promise<UsageCounter | null> {
    return this.counters.findOne({ where: { pharmacyTenantId: tenantId, period } });
  }

  private used(row: UsageCounter | null, resource: MeteredResource): number {
    if (!row) return 0;
    return resource === 'ai' ? row.aiRequests : row.whatsappConversations;
  }

  /** Read-only view for the app's credits meter and the GET /usage endpoint. */
  async summary(tenantId: string): Promise<UsageSummary> {
    const period = currentPeriod();
    const [tier, row] = await Promise.all([this.planOf(tenantId), this.countersOf(tenantId, period)]);
    const build = (resource: MeteredResource): UsageCheck => {
      const limit = capFor(tier, resource);
      const used = this.used(row, resource);
      return {
        allowed: limit === null || used < limit,
        used,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
      };
    };
    return { period, planTier: tier, ai: build('ai'), whatsapp: build('whatsapp') };
  }

  /**
   * Check the cap and, if allowed, atomically consume one unit. Returns allowed=false
   * WITHOUT consuming when the monthly cap is reached (and notifies once).
   */
  async consume(tenantId: string, resource: MeteredResource): Promise<UsageCheck> {
    const period = currentPeriod();
    const tier = await this.planOf(tenantId);
    const limit = capFor(tier, resource);
    const row = await this.countersOf(tenantId, period);
    const used = this.used(row, resource);

    if (limit !== null && used >= limit) {
      await this.notifyLimitReached(tenantId, resource, period, limit).catch(() => undefined);
      return { allowed: false, used, limit, remaining: 0 };
    }

    const col = resource === 'ai' ? 'aiRequests' : 'whatsappConversations';
    await this.counters.query(
      `INSERT INTO usage_counters ("pharmacyTenantId", period, "${col}")
       VALUES ($1, $2, 1)
       ON CONFLICT ("pharmacyTenantId", period)
       DO UPDATE SET "${col}" = usage_counters."${col}" + 1, "updatedAt" = now()`,
      [tenantId, period],
    );

    const newUsed = used + 1;
    return {
      allowed: true,
      used: newUsed,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - newUsed),
    };
  }

  /** One in-app "credits finished" alert per (tenant, resource, month). */
  private async notifyLimitReached(
    tenantId: string, resource: MeteredResource, period: string, limit: number,
  ): Promise<void> {
    const resourceRef = `usage:${resource}:${period}`;
    const exists = await this.notifications.findOne({
      where: { tenantId, resourceRef },
      select: ['id'],
    });
    if (exists) return;

    const isAi = resource === 'ai';
    await this.notifications.save(this.notifications.create({
      tenantId,
      type: 'usage_limit_reached',
      title: isAi ? 'انتهى رصيد الذكاء الاصطناعي لهذا الشهر' : 'انتهى رصيد رسائل واتساب لهذا الشهر',
      body: isAi
        ? `لقد استهلكت ${limit} طلب ذكاء اصطناعي هذا الشهر. سيُستأنف تلقائياً مع بداية الشهر القادم، أو رقِّ باقتك للمزيد.`
        : `لقد استهلكت ${limit} محادثة واتساب هذا الشهر. ستتوقف رسائل واتساب حتى بداية الشهر القادم، أو رقِّ باقتك للمزيد.`,
      resourceRef,
      severity: 'high',
      channels: ['in_app'],
    } as Partial<Notification>));
  }
}

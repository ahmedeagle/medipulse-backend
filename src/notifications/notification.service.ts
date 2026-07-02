import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import {
  NotificationSeverity,
  NotificationChannel,
  severityForType,
  channelsForSeverity,
} from './notification-policy';
import {
  NotificationCategory,
  ALL_CATEGORIES,
  typesForCategory,
} from './notification-category';
import { NotificationDispatcherService } from './notification-dispatcher.service';

export interface CreateNotificationDto {
  tenantId:    string;
  userId?:     string;
  type:        NotificationType;
  title:       string;
  body:        string;
  resourceRef?: string;
  emailSent?:  boolean;
  /** Override the type-derived severity when the caller knows the real urgency. */
  severity?:   NotificationSeverity;
  /** Override the severity-derived delivery channels. */
  channels?:   NotificationChannel[];
  /**
   * Optional coalescing window (ms). When set, a near-identical notification
   * already created within the window is reused instead of inserting a new
   * row — kills repeat-spam (e.g. the same purchase task notified every cron
   * run). Dedup key defaults to `resourceRef` when present, else `title`.
   */
  dedupeWindowMs?: number;
  dedupeBy?: 'resourceRef' | 'title';
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly dispatcher: NotificationDispatcherService,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const { dedupeWindowMs, dedupeBy, severity: sevIn, channels: chIn, ...base } = dto;

    // Central decision model: classify severity + intended channels from the type
    // policy unless the caller overrode them. Applies to every producer for free.
    const severity = sevIn ?? severityForType(base.type);
    let channels = chIn ?? channelsForSeverity(severity);

    // Preference Filter — only when the intended channels include an external
    // (opt-in) channel. Low/medium in-app notifications skip this entirely, so the
    // common path pays no extra query.
    if (channels.includes('whatsapp') || channels.includes('push')) {
      channels = await this.dispatcher.route(base.tenantId, base.userId ?? null, severity, channels);
    }
    const row = { ...base, severity, channels };

    if (dedupeWindowMs && dedupeWindowMs > 0) {
      const since = new Date(Date.now() - dedupeWindowMs);
      const by = dedupeBy ?? (row.resourceRef ? 'resourceRef' : 'title');
      const qb = this.repo
        .createQueryBuilder('n')
        .where('n.tenantId = :tenantId', { tenantId: row.tenantId })
        .andWhere('n.type = :type', { type: row.type })
        .andWhere('n.createdAt >= :since', { since });
      if (by === 'resourceRef' && row.resourceRef) {
        qb.andWhere('n.resourceRef = :ref', { ref: row.resourceRef });
      } else {
        qb.andWhere('n.title = :title', { title: row.title });
      }
      if (row.userId) {
        qb.andWhere('(n.userId = :userId OR n.userId IS NULL)', { userId: row.userId });
      }
      const existing = await qb.getOne();
      if (existing) return existing;
    }

    const saved = await this.repo.save(this.repo.create(row));

    // Delivery Dispatcher — external side effects (WhatsApp) run after persistence,
    // gated + idempotent + non-fatal. Fire-and-forget so create() stays fast.
    if (saved.channels?.includes('whatsapp')) {
      void this.dispatcher.dispatchExternal(saved);
    }

    return saved;
  }

  async findForUser(
    tenantId: string,
    userId: string,
    limit = 30,
  ): Promise<Notification[]> {
    return this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('(n.userId = :userId OR n.userId IS NULL)', { userId })
      .orderBy('n.createdAt', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * Paginated + filtered feed for the Notification Center. Category and read
   * state are filtered in the database (indexed on tenantId/userId/isRead/
   * createdAt) so it stays fast even with very large notification volumes —
   * we never load the full table into memory. Returns a bounded page plus the
   * matching total so the client can drive "load more".
   */
  async findPage(
    tenantId: string,
    userId: string,
    opts: {
      category?: NotificationCategory;
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: Notification[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50);
    const offset = Math.max(opts.offset ?? 0, 0);

    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('(n.userId = :userId OR n.userId IS NULL)', { userId });

    if (opts.unreadOnly) qb.andWhere('n.isRead = false');

    if (opts.category) {
      const types = typesForCategory(opts.category);
      if (types.length) qb.andWhere('n.type IN (:...types)', { types });
      else qb.andWhere('1 = 0');
    }

    const [data, total] = await qb
      .orderBy('n.createdAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    return { data, total, limit, offset };
  }

  /**
   * Per-category totals + unread counts in a single grouped query, so the
   * center's tab badges never require scanning every row on the client.
   */
  async getCategoryCounts(
    tenantId: string,
    userId: string,
  ): Promise<{
    total: number;
    unread: number;
    categories: Record<NotificationCategory, { total: number; unread: number }>;
  }> {
    const rows: Array<{ type: string; total: string; unread: string }> = await this.repo
      .createQueryBuilder('n')
      .select('n.type', 'type')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE n.isRead = false)', 'unread')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('(n.userId = :userId OR n.userId IS NULL)', { userId })
      .groupBy('n.type')
      .getRawMany();

    const categories = ALL_CATEGORIES.reduce((acc, c) => {
      acc[c] = { total: 0, unread: 0 };
      return acc;
    }, {} as Record<NotificationCategory, { total: number; unread: number }>);

    let total = 0;
    let unread = 0;

    for (const r of rows) {
      const t = Number(r.total) || 0;
      const u = Number(r.unread) || 0;
      total += t;
      unread += u;
      const cat = ALL_CATEGORIES.find((c) => typesForCategory(c).includes(r.type as any));
      if (cat) {
        categories[cat].total += t;
        categories[cat].unread += u;
      }
    }

    return { total, unread, categories };
  }


  async getUnreadCount(tenantId: string, userId: string): Promise<number> {
    return this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('(n.userId = :userId OR n.userId IS NULL)', { userId })
      .andWhere('n.isRead = false')
      .getCount();
  }

  async markRead(tenantId: string, userId: string, id: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ isRead: true, readAt: new Date() })
      .where('id = :id', { id })
      .andWhere('tenantId = :tenantId', { tenantId })
      .execute();
  }

  async findByResourceRef(resourceRef: string, tenantId: string): Promise<Notification | null> {
    return this.repo.findOne({ where: { resourceRef, tenantId } });
  }

  async findTodayDigest(tenantId: string, todayStart: Date): Promise<Notification | null> {
    return this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('n.type = :type', { type: 'expiry_digest' })
      .andWhere('n.createdAt >= :start', { start: todayStart })
      .getOne();
  }

  async findTodayExpiredDigest(tenantId: string, todayKey: string): Promise<Notification | null> {
    const start = new Date(`${todayKey}T00:00:00.000Z`);
    return this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('n.type = :type', { type: 'expired_stock' })
      .andWhere('n.createdAt >= :start', { start })
      .getOne();
  }

  async findTodayLowStockAlert(tenantId: string, productId: string, todayKey: string): Promise<Notification | null> {
    const start = new Date(`${todayKey}T00:00:00.000Z`);
    return this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('n.type = :type', { type: 'low_stock' })
      .andWhere("n.resourceRef LIKE :ref", { ref: `%productId=${productId}%` })
      .andWhere('n.createdAt >= :start', { start })
      .getOne();
  }

  async findRecentDeadStockAlert(tenantId: string, since: Date): Promise<Notification | null> {
    return this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('n.type = :type', { type: 'dead_stock' })
      .andWhere('n.createdAt >= :since', { since })
      .getOne();
  }

  /** Generic dedup: was a notification of this type sent to the tenant since `since`? */
  async findRecentByType(tenantId: string, type: NotificationType, since: Date): Promise<Notification | null> {
    return this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('n.type = :type', { type })
      .andWhere('n.createdAt >= :since', { since })
      .getOne();
  }

  /** Generic dedup scoped to a specific user (used for per-user notifications like morning briefing). */
  async findRecentByTypeForUser(tenantId: string, userId: string, type: NotificationType, since: Date): Promise<Notification | null> {
    return this.repo
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('n.userId = :userId', { userId })
      .andWhere('n.type = :type', { type })
      .andWhere('n.createdAt >= :since', { since })
      .getOne();
  }

  async markAllRead(tenantId: string, userId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ isRead: true, readAt: new Date() })
      .where('tenantId = :tenantId', { tenantId })
      .andWhere('(userId = :userId OR userId IS NULL)', { userId })
      .andWhere('isRead = false')
      .execute();
  }
}

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
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const { dedupeWindowMs, dedupeBy, severity: sevIn, channels: chIn, ...base } = dto;

    // Central decision model: classify severity + intended channels from the type
    // policy unless the caller overrode them. Applies to every producer for free.
    const severity = sevIn ?? severityForType(base.type);
    const channels = chIn ?? channelsForSeverity(severity);
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

    return this.repo.save(this.repo.create(row));
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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';

export interface CreateNotificationDto {
  tenantId:    string;
  userId?:     string;
  type:        NotificationType;
  title:       string;
  body:        string;
  resourceRef?: string;
  emailSent?:  boolean;
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    return this.repo.save(this.repo.create(dto));
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

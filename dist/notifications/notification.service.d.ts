import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
export interface CreateNotificationDto {
    tenantId: string;
    userId?: string;
    type: NotificationType;
    title: string;
    body: string;
    resourceRef?: string;
    emailSent?: boolean;
}
export declare class NotificationService {
    private readonly repo;
    constructor(repo: Repository<Notification>);
    create(dto: CreateNotificationDto): Promise<Notification>;
    findForUser(tenantId: string, userId: string, limit?: number): Promise<Notification[]>;
    getUnreadCount(tenantId: string, userId: string): Promise<number>;
    markRead(tenantId: string, userId: string, id: string): Promise<void>;
    markAllRead(tenantId: string, userId: string): Promise<void>;
}

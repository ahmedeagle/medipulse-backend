import { NotificationService } from './notification.service';
export declare class NotificationController {
    private readonly svc;
    constructor(svc: NotificationService);
    find(user: any, limit: number): Promise<import("./entities/notification.entity").Notification[]>;
    getUnreadCount(user: any): Promise<{
        count: number;
    }>;
    markRead(user: any, id: string): Promise<void>;
    markAllRead(user: any): Promise<void>;
}

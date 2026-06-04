import { Repository } from 'typeorm';
import { NotificationService } from './notification.service';
import { NotificationEmailService } from './notification-email.service';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { RecommendationGeneratedEvent, OrderStatusChangedEvent, OrderDeliveredEvent } from '../events/domain-events';
export declare class NotificationEventListener {
    private readonly notificationSvc;
    private readonly emailSvc;
    private readonly userRepo;
    private readonly tenantRepo;
    private readonly logger;
    constructor(notificationSvc: NotificationService, emailSvc: NotificationEmailService, userRepo: Repository<User>, tenantRepo: Repository<Tenant>);
    onRecommendationGenerated(event: RecommendationGeneratedEvent): Promise<void>;
    onOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void>;
    onOrderDelivered(event: OrderDeliveredEvent): Promise<void>;
    private getAdmins;
}

import { Repository } from 'typeorm';
import { OrderReturnRequest } from '../orders/entities/order-return-request.entity';
import { OrderComment } from '../orders/entities/order-comment.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { User } from '../auth/entities/user.entity';
export declare class OrderWorkflowService {
    private readonly returnRepo;
    private readonly commentRepo;
    private readonly recRepo;
    private readonly userRepo;
    private readonly notificationSvc;
    private readonly emailSvc;
    private readonly logger;
    constructor(returnRepo: Repository<OrderReturnRequest>, commentRepo: Repository<OrderComment>, recRepo: Repository<AiRecommendation>, userRepo: Repository<User>, notificationSvc: NotificationService, emailSvc: NotificationEmailService);
    onOrderSubmitted(event: {
        orderId: string;
        pharmacyTenantId: string;
        supplierTenantId: string;
    }): Promise<void>;
    onApprovalRequired(event: {
        orderId: string;
        pharmacyTenantId: string;
        totalAmount: number;
    }): Promise<void>;
    onStatusChanged(event: {
        orderId: string;
        pharmacyTenantId: string;
        supplierTenantId: string;
        from: string;
        to: string;
    }): Promise<void>;
    onOrderDelivered(event: {
        orderId: string;
        pharmacyTenantId: string;
        items: Array<{
            productId: string;
        }>;
    }): Promise<void>;
    onReturnRequested(event: {
        orderId: string;
        pharmacyTenantId: string;
    }): Promise<void>;
    private getAdmins;
}

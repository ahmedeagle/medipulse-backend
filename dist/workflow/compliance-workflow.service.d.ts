import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository, DataSource } from 'typeorm';
import { ProductBatch } from '../inventory/entities/product-batch.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { User } from '../auth/entities/user.entity';
export declare class ComplianceWorkflowService {
    private readonly batchRepo;
    private readonly inventoryRepo;
    private readonly userRepo;
    private readonly dataSource;
    private readonly notificationSvc;
    private readonly emailSvc;
    private readonly emitter;
    private readonly logger;
    constructor(batchRepo: Repository<ProductBatch>, inventoryRepo: Repository<InventoryItem>, userRepo: Repository<User>, dataSource: DataSource, notificationSvc: NotificationService, emailSvc: NotificationEmailService, emitter: EventEmitter2);
    onProductRecalled(event: {
        recallId: string;
        productId: string;
        batchNumber?: string;
        recallType: string;
        recallReferenceNumber: string;
        affectedPharmacyIds: string[];
    }): Promise<void>;
    checkExpiryAlerts(): Promise<void>;
    private getAdmins;
    private buildRecallEmail;
}

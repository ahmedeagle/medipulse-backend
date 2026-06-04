import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProcurementSchedule } from '../forecasting/entities/procurement-schedule.entity';
import { ProcurementDraft } from './entities/procurement-draft.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
export declare class AutoDraftSchedulerService {
    private readonly scheduleRepo;
    private readonly draftRepo;
    private readonly recRepo;
    private readonly catalogRepo;
    private readonly userRepo;
    private readonly tenantRepo;
    private readonly notificationSvc;
    private readonly emailSvc;
    private readonly emitter;
    private readonly logger;
    constructor(scheduleRepo: Repository<ProcurementSchedule>, draftRepo: Repository<ProcurementDraft>, recRepo: Repository<AiRecommendation>, catalogRepo: Repository<SupplierCatalogItem>, userRepo: Repository<User>, tenantRepo: Repository<Tenant>, notificationSvc: NotificationService, emailSvc: NotificationEmailService, emitter: EventEmitter2);
    runDailyDraftGeneration(): Promise<void>;
    private _run;
    private notifyPharmacyAdmins;
}

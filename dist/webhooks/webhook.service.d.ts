import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
export declare class WebhookService {
    private subRepo;
    private deliveryRepo;
    private readonly deliveryQueue;
    constructor(subRepo: Repository<WebhookSubscription>, deliveryRepo: Repository<WebhookDelivery>, deliveryQueue: Queue);
    create(tenantId: string, dto: {
        url: string;
        events: string[];
    }): Promise<WebhookSubscription>;
    list(tenantId: string): Promise<WebhookSubscription[]>;
    remove(tenantId: string, id: string): Promise<void>;
    listDeliveries(tenantId: string, id: string): Promise<WebhookDelivery[]>;
    sendTestEvent(tenantId: string, id: string): Promise<{
        jobId: string;
    }>;
    dispatchEvent(eventType: string, data: Record<string, any>): Promise<void>;
    enqueueDelivery(sub: WebhookSubscription, eventType: string, payload: Record<string, any>): Promise<import("bullmq").Job<any, any, string>>;
    sign(secret: string, body: string): string;
    private validateEvents;
    private findOwned;
}

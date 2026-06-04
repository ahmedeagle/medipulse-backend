import { WorkerHost } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
interface DeliverJobData {
    subscriptionId: string;
    url: string;
    payload: Record<string, any>;
    signature: string;
    eventType: string;
}
export declare class WebhookDeliveryProcessor extends WorkerHost {
    private deliveryRepo;
    private subRepo;
    private readonly logger;
    constructor(deliveryRepo: Repository<WebhookDelivery>, subRepo: Repository<WebhookSubscription>);
    process(job: Job<DeliverJobData>): Promise<void>;
    onFailed(job: Job<DeliverJobData>, err: Error): Promise<void>;
}
export {};

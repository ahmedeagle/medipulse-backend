import { WebhookService } from './webhook.service';
declare class CreateWebhookDto {
    url: string;
    events: string[];
}
export declare class WebhookController {
    private readonly webhookService;
    constructor(webhookService: WebhookService);
    create(user: any, dto: CreateWebhookDto): Promise<import("./entities/webhook-subscription.entity").WebhookSubscription>;
    list(user: any): Promise<import("./entities/webhook-subscription.entity").WebhookSubscription[]>;
    remove(user: any, id: string): Promise<void>;
    listDeliveries(user: any, id: string): Promise<import("./entities/webhook-delivery.entity").WebhookDelivery[]>;
    sendTest(user: any, id: string): Promise<{
        jobId: string;
    }>;
}
export {};

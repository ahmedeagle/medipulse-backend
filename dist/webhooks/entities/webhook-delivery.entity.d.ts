import { WebhookSubscription } from './webhook-subscription.entity';
export declare class WebhookDelivery {
    id: string;
    subscriptionId: string;
    subscription: WebhookSubscription;
    eventType: string;
    payload: Record<string, any>;
    statusCode: number;
    attemptCount: number;
    lastAttemptAt: Date;
    deliveredAt: Date;
    error: string;
    createdAt: Date;
}

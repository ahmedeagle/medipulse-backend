export declare class WebhookSubscription {
    id: string;
    tenantId: string;
    url: string;
    events: string[];
    secret: string;
    isActive: boolean;
    requiresAttention: boolean;
    createdAt: Date;
    updatedAt: Date;
}

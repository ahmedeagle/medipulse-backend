export declare class DomainEventLog {
    id: string;
    eventType: string;
    aggregateId: string;
    aggregateType: string;
    tenantId: string;
    payload: Record<string, any>;
    correlationId: string;
    createdAt: Date;
}

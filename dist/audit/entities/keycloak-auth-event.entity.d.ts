export declare class KeycloakAuthEvent {
    id: string;
    kcEventId: string;
    eventType: string;
    kcUserId: string;
    tenantId: string;
    sessionId: string;
    ipAddress: string;
    clientId: string;
    details: Record<string, any>;
    time: number;
}

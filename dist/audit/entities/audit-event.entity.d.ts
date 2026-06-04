export declare class AuditEvent {
    id: string;
    tenantId: string;
    userId: string;
    resource: string;
    method: string;
    path: string;
    statusCode: number;
    latencyMs: number;
    resourceId: string;
    ipAddress: string;
    userAgent: string;
    createdAt: Date;
}

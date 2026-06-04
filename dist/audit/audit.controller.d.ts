import { AuditService } from './audit.service';
export declare class AuditController {
    private readonly auditService;
    constructor(auditService: AuditService);
    query(user: any, resource?: string, userId?: string, from?: string, to?: string, limit?: number, offset?: number): Promise<{
        data: import("./entities/audit-event.entity").AuditEvent[];
        total: number;
    }>;
}

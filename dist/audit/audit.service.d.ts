import { Repository } from 'typeorm';
import { AuditEvent } from './entities/audit-event.entity';
export interface AuditQuery {
    tenantId?: string;
    resource?: string;
    userId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
}
export declare class AuditService {
    private readonly auditRepo;
    constructor(auditRepo: Repository<AuditEvent>);
    query(params: AuditQuery): Promise<{
        data: AuditEvent[];
        total: number;
    }>;
}

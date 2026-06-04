import { WorkerHost } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { AuditEvent } from './entities/audit-event.entity';
export declare class AuditEventProcessor extends WorkerHost {
    private readonly auditRepo;
    private readonly logger;
    constructor(auditRepo: Repository<AuditEvent>);
    process(job: Job): Promise<void>;
    onFailed(job: Job, err: Error): void;
}

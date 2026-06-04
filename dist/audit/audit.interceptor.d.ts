import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Observable } from 'rxjs';
export declare class AuditInterceptor implements NestInterceptor {
    private readonly auditQueue;
    private readonly logger;
    constructor(auditQueue: Queue);
    intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
}

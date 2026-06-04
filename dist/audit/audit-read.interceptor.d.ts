import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { ReadAccessLog } from './entities/read-access-log.entity';
export declare class AuditReadInterceptor implements NestInterceptor {
    private readonly reflector;
    private readonly repo;
    private readonly logger;
    constructor(reflector: Reflector, repo: Repository<ReadAccessLog>);
    intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
}

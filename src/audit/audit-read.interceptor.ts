import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_READ_KEY } from './decorators/audit-read.decorator';
import { ReadAccessLog } from './entities/read-access-log.entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuditReadInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditReadInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(ReadAccessLog, 'audit')
    private readonly repo: Repository<ReadAccessLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const resource = this.reflector.getAllAndOverride<string>(AUDIT_READ_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Only log if @AuditRead() is present on this route
    if (!resource) return next.handle();

    const req  = context.switchToHttp().getRequest();
    const user = req.user as any;

    return next.handle().pipe(
      tap(() => {
        // Extract first UUID param as resourceId (e.g. /:id routes)
        const paramId = Object.values(req.params ?? {}).find(
          (v) => typeof v === 'string' && UUID_RE.test(v),
        ) as string | undefined;

        this.repo
          .save(
            this.repo.create({
              tenantId:   user?.tenantId  ?? null,
              userId:     user?.id        ?? null,
              resource,
              path:       req.route?.path ?? req.path,
              resourceId: paramId        ?? null,
              ipAddress:  req.ip         ?? null,
              userAgent:  req.headers?.['user-agent'] ?? null,
            }),
          )
          .catch((err) => this.logger.warn(`ReadAccessLog write failed: ${err.message}`));
      }),
    );
  }
}

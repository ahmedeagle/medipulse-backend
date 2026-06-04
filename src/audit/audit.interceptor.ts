import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { AUDIT_JOB, AUDIT_QUEUE } from './audit.constants';

const SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIP_PATHS   = ['/health', '/docs', '/admin/queues'];

/** Derives the domain resource name from a URL path segment. */
function extractResource(path: string): string {
  const segment = path.replace(/^\/api\/v\d+\//, '').split('/')[0];
  return segment || 'unknown';
}

/** UUID shape — used to extract resourceId from response bodies */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    @InjectQueue(AUDIT_QUEUE) private readonly auditQueue: Queue,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req   = context.switchToHttp().getRequest();
    const start = Date.now();

    if (
      SKIP_METHODS.has(req.method) ||
      SKIP_PATHS.some((p) => req.path?.startsWith(p))
    ) {
      return next.handle();
    }

    const emitAudit = (statusCode: number, resourceId?: string) => {
      const user = req.user as any;
      this.auditQueue
        .add(
          AUDIT_JOB,
          {
            tenantId:   user?.tenantId  ?? null,
            userId:     user?.id        ?? null,
            resource:   extractResource(req.path),
            method:     req.method,
            path:       req.route?.path ?? req.path,
            statusCode,
            latencyMs:  Date.now() - start,
            resourceId: resourceId ?? null,
            ipAddress:  req.ip ?? null,
            userAgent:  req.headers?.['user-agent'] ?? null,
          },
          // Fire-and-forget — audit queue options are separate from AI queue
          { removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } },
        )
        .catch((err) => this.logger.warn(`Audit enqueue failed: ${err.message}`));
    };

    return next.handle().pipe(
      tap((body) => {
        const statusCode = context.switchToHttp().getResponse().statusCode;
        const resourceId = body?.id && UUID_RE.test(body.id) ? body.id : undefined;
        emitAudit(statusCode, resourceId);
      }),
      catchError((err) => {
        emitAudit(err?.status ?? 500);
        return throwError(() => err);
      }),
    );
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Attaches a correlation ID to every request.
 * If the caller provides X-Correlation-ID it is honoured; otherwise a UUID is generated.
 * The ID is written back to the response header so clients can trace their requests.
 *
 * BullMQ jobs should include the correlationId from the originating HTTP request
 * so worker traces can be linked back to the API call that triggered them.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const existing = req.headers[CORRELATION_ID_HEADER] as string | undefined;
    const correlationId = existing ?? randomUUID();

    req.headers[CORRELATION_ID_HEADER] = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}

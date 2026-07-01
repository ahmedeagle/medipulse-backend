import {
  CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus,
} from '@nestjs/common';
import { UsageService } from './usage.service';

/**
 * Blocks a user-initiated AI request when the tenant has exhausted its monthly AI
 * cap. Consumes one AI credit on success. Returns HTTP 402 (Payment Required) with
 * a clear Arabic message so the frontend can prompt an upgrade.
 */
@Injectable()
export class AiUsageGuard implements CanActivate {
  constructor(private readonly usage: UsageService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const tenantId: string | null = req?.user?.tenantId ?? null;
    if (!tenantId) return true; // auth guard handles missing tenant elsewhere

    const check = await this.usage.consume(tenantId, 'ai');
    if (!check.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'AI_CREDITS_EXHAUSTED',
          message: `انتهى رصيد الذكاء الاصطناعي لهذا الشهر (${check.limit} طلب). سيُستأنف مع بداية الشهر القادم، أو رقِّ باقتك للمزيد.`,
          limit: check.limit,
          used: check.used,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return true;
  }
}

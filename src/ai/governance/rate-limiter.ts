import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/**
 * Per-tenant AI generation rate limiter — Redis-backed.
 *
 * Limits: 10 generations/hour, 50/day per tenant.
 *
 * Uses atomic INCR + EXPIRE so multiple API replicas share the same counters.
 * Race-condition-free: INCR is atomic in Redis; EXPIRE is set only on first increment.
 */

const HOURLY_LIMIT = 10;
const DAILY_LIMIT  = 50;

@Injectable()
export class AiRateLimiter {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(tenantId: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const now    = Date.now();
    const hourMs = 3_600;       // Redis EXPIRE takes seconds
    const dayMs  = 86_400;

    const hourKey = `medipulse:ai:rl:${tenantId}:h`;
    const dayKey  = `medipulse:ai:rl:${tenantId}:d`;

    // Atomic: increment then set TTL only on first call within the window
    const [hourlyCount, dailyCount] = await Promise.all([
      this.atomicIncr(hourKey, hourMs),
      this.atomicIncr(dayKey,  dayMs),
    ]);

    if (hourlyCount > HOURLY_LIMIT) {
      const ttl = await this.redis.ttl(hourKey);
      return { allowed: false, remaining: 0, resetAt: new Date(now + ttl * 1_000) };
    }

    if (dailyCount > DAILY_LIMIT) {
      const ttl = await this.redis.ttl(dayKey);
      return { allowed: false, remaining: 0, resetAt: new Date(now + ttl * 1_000) };
    }

    return {
      allowed:   true,
      remaining: Math.min(HOURLY_LIMIT - hourlyCount, DAILY_LIMIT - dailyCount),
      resetAt:   new Date(now + hourMs * 1_000),
    };
  }

  async assertAllowed(tenantId: string): Promise<void> {
    const result = await this.check(tenantId);
    if (!result.allowed) {
      throw new HttpException(
        `AI generation rate limit exceeded. Resets at ${result.resetAt.toISOString()}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async atomicIncr(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      // First increment in this window — set the expiry
      await this.redis.expire(key, ttlSeconds);
    }
    return count;
  }
}

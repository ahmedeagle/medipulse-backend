import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Distributed cron lock using Redis SET NX.
 * Prevents duplicate cron runs when multiple pods are deployed.
 * Any pod that acquires the lock runs the job; others skip silently.
 * TTL auto-expires the lock so pods recover after a crash.
 */
@Injectable()
export class CronLockService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Returns true only for the pod that won the lock. */
  async acquire(name: string, ttlSeconds = 7200): Promise<boolean> {
    // ioredis v5: argument order mirrors Redis SET syntax — EX <seconds> before NX
    const result = await this.redis.set(
      `medipulse:cron:lock:${name}`,
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  async release(name: string): Promise<void> {
    await this.redis.del(`medipulse:cron:lock:${name}`);
  }
}

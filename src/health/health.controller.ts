import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import type { Redis } from 'ioredis';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly mainDb: DataSource,
    @InjectDataSource('audit') private readonly auditDb: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe — is the process alive?' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks main DB, audit DB, and Redis' })
  async ready() {
    const checks = await Promise.allSettled([
      this.mainDb.query('SELECT 1').then(() => 'connected'),
      this.auditDb.query('SELECT 1').then(() => 'connected'),
      this.redis.ping().then(() => 'connected'),
    ]);

    const [mainDbResult, auditDbResult, redisResult] = checks;

    const result = {
      status: checks.every((c) => c.status === 'fulfilled') ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      mainDb:  mainDbResult.status  === 'fulfilled' ? 'connected' : 'disconnected',
      auditDb: auditDbResult.status === 'fulfilled' ? 'connected' : 'disconnected',
      redis:   redisResult.status   === 'fulfilled' ? 'connected' : 'disconnected',
    };

    return result;
  }
}

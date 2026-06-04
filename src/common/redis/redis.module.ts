import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): Redis => new Redis({
        host:     cfg.get<string>('REDIS_HOST', 'localhost'),
        port:     cfg.get<number>('REDIS_PORT', 6379),
        password: cfg.get<string>('REDIS_PASSWORD') || undefined,
        lazyConnect: false,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
      }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

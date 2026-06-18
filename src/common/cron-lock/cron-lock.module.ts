import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { CronLockService } from './cron-lock.service';

@Module({
  imports: [RedisModule],
  providers: [CronLockService],
  exports: [CronLockService],
})
export class CronLockModule {}

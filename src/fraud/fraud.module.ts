import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { Approval }        from '../ai-governance/entities/approval.entity';
import { CronLockModule }  from '../common/cron-lock/cron-lock.module';
import { FraudService }    from './fraud.service';
import { FraudCron }       from './fraud.cron';

/**
 * Fraud & anomaly detection module.
 *
 * Runs 5 rules daily at 02:00 UTC per active pharmacy tenant.
 * Uses Redis CronLock to prevent duplicate runs across multiple pods.
 * Tenants are scanned in parallel batches of 10.
 *
 * Signals surface as Approval cards with agentCode = 'fraud_detector'
 * and subjectType = 'fraud_signal' — the AI Center Approvals tab renders
 * them with no frontend changes needed.
 *
 * Deduplication uses a deterministic UUID in subjectId (indexed) so dedup
 * checks are O(log n) rather than a sequential JSONB payload scan.
 *
 * Rules:
 *   1. HIGH_DISCOUNT_RATE        — > 3 listings with discount > 40% in 30 days
 *   2. ORDER_CHURN_ABUSE         — > 2 orders placed+cancelled within 2h in 30 days
 *   3. RUBBER_STAMP_APPROVALS    — > 70% of AI decisions made in < 5 seconds (min 10 sample)
 *   4. PRICE_DUMPING             — P2P listing < 70% of own cost price
 *   5. BULK_MULTI_SOURCE_ORDER   — same product ordered from ≥ 3 sellers in 24h
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CronLockModule,
    TypeOrmModule.forFeature([Approval]),
  ],
  providers: [FraudService, FraudCron],
  exports:   [FraudService],
})
export class FraudModule {}

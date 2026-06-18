import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

import { CronLockService } from '../common/cron-lock/cron-lock.service';
import { FraudService }    from './fraud.service';

/** Max tenants scanned concurrently. Each scan runs 5 parallel SQL queries.
 *  10 × 5 = 50 simultaneous queries — well within pg pool limit of 20
 *  because each query is fast (< 200 ms). */
const SCAN_CONCURRENCY = 10;

/**
 * Runs fraud detection once per day at 02:00 UTC — off-peak to avoid
 * contention with the morning briefing cron at 07:00 UTC.
 *
 * Redis CronLock ensures only one pod runs the scan in multi-instance
 * deployments (Kubernetes, ECS, etc.).
 *
 * Active tenants are discovered from inventory_items — any pharmacy that
 * has at least one non-deleted item is considered active. This avoids a
 * cross-module dependency on AuthModule / Tenant entity.
 */
@Injectable()
export class FraudCron {
  private readonly logger = new Logger(FraudCron.name);

  constructor(
    private readonly fraudService: FraudService,
    private readonly dataSource:   DataSource,
    private readonly cronLock:     CronLockService,
  ) {}

  @Cron('0 2 * * *', { name: 'fraud_daily_scan', timeZone: 'UTC' })
  async runDailyScan(): Promise<void> {
    // Acquire distributed lock (TTL 1 h — longer than any realistic scan)
    const locked = await this.cronLock.acquire('fraud_daily_scan', 3_600);
    if (!locked) {
      this.logger.debug('fraud_daily_scan: lock held by another pod — skipping');
      return;
    }

    try {
      await this.scan();
    } finally {
      await this.cronLock.release('fraud_daily_scan');
    }
  }

  private async scan(): Promise<void> {
    this.logger.log('Fraud daily scan — starting');

    const tenantRows = await this.dataSource.query<{ tenantId: string }[]>(`
      SELECT DISTINCT "pharmacyTenantId" AS "tenantId"
      FROM   inventory_items
      WHERE  "deletedAt" IS NULL
    `);

    let passed = 0;
    let failed = 0;

    // Process in batches to bound DB concurrency
    for (let i = 0; i < tenantRows.length; i += SCAN_CONCURRENCY) {
      const batch = tenantRows.slice(i, i + SCAN_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(({ tenantId }) => this.fraudService.scanTenant(tenantId)),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          passed++;
        } else {
          failed++;
          this.logger.error({ event: 'fraud.scan_tenant_failed', reason: String(r.reason) });
        }
      }
    }

    this.logger.log(
      JSON.stringify({ event: 'fraud.scan_complete', passed, failed, total: tenantRows.length }),
    );
  }
}

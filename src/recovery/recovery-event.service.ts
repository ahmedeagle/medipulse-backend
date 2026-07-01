import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  RecoveryEvent,
  RecoveryEventType,
  RecoveryEventStatus,
  RecoverySourceType,
} from './entities/recovery-event.entity';

export interface RecordRecoveryDto {
  pharmacyTenantId: string;
  type: RecoveryEventType;
  status?: RecoveryEventStatus;     // default 'realized'
  amountEgp?: number;               // realized money captured (default 0)
  expectedValueEgp?: number | null; // value at risk / expected recovery
  realizedValueEgp?: number | null;
  productId?: string | null;
  sourceType: RecoverySourceType;
  sourceId?: string | null;         // idempotency key with (sourceType, type)
  subjectType?: string | null;
  metadata?: Record<string, any> | null;
}

export interface RecoverySummary {
  since: string;
  realizedEgp: number;   // money actually captured
  pipelineEgp: number;   // projected recovery not yet realized
  byType: Array<{ type: RecoveryEventType; realizedEgp: number; pipelineEgp: number; count: number }>;
}

@Injectable()
export class RecoveryEventService {
  private readonly logger = new Logger(RecoveryEventService.name);

  constructor(
    @InjectRepository(RecoveryEvent)
    private readonly repo: Repository<RecoveryEvent>,
  ) {}

  /**
   * Idempotent write. A duplicate (sourceType, sourceId, type) is silently ignored
   * via ON CONFLICT DO NOTHING, so an executor/cron that fires twice never
   * double-counts. Never throws into the caller's execution path — recording impact
   * must not break the business action it measures.
   */
  async record(dto: RecordRecoveryDto): Promise<void> {
    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(RecoveryEvent)
        .values({
          pharmacyTenantId: dto.pharmacyTenantId,
          type: dto.type,
          status: dto.status ?? 'realized',
          amountEgp: dto.amountEgp ?? 0,
          expectedValueEgp: dto.expectedValueEgp ?? null,
          realizedValueEgp: dto.realizedValueEgp ?? null,
          productId: dto.productId ?? null,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId ?? null,
          subjectType: dto.subjectType ?? null,
          metadata: dto.metadata ?? null,
        })
        .orIgnore() // ON CONFLICT DO NOTHING (uq_recovery_source)
        .execute();
    } catch (err) {
      this.logger.warn(
        `recovery record failed (${dto.type}/${dto.sourceId ?? 'n/a'}): ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Grouped time-range aggregation. Covered by idx_recovery_tenant_type_created,
   * so it's an index-only range scan even with millions of rows per tenant.
   */
  async summary(tenantId: string, since: Date): Promise<RecoverySummary> {
    const rows = await this.repo
      .createQueryBuilder('e')
      .select('e.type', 'type')
      .addSelect(`COALESCE(SUM(CASE WHEN e.status = 'realized' THEN e."amountEgp" ELSE 0 END), 0)`, 'realized')
      .addSelect(`COALESCE(SUM(CASE WHEN e.status = 'projected' THEN COALESCE(e."expectedValueEgp", 0) ELSE 0 END), 0)`, 'pipeline')
      .addSelect('COUNT(*)', 'count')
      .where('e.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('e.createdAt >= :since', { since })
      .groupBy('e.type')
      .getRawMany<{ type: RecoveryEventType; realized: string; pipeline: string; count: string }>();

    let realizedEgp = 0;
    let pipelineEgp = 0;
    const byType = rows.map((r) => {
      const realized = Number(r.realized);
      const pipeline = Number(r.pipeline);
      realizedEgp += realized;
      pipelineEgp += pipeline;
      return { type: r.type, realizedEgp: realized, pipelineEgp: pipeline, count: Number(r.count) };
    });

    return { since: since.toISOString(), realizedEgp, pipelineEgp, byType };
  }
}

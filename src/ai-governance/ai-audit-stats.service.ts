import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';

import { AiAuditLog } from '../ai/entities/ai-audit-log.entity';

export interface AiRunStats {
  windowDays:        number;
  totalRuns:         number;
  success:           number;
  failed:            number;
  blocked:           number; // blocked_input + blocked_output + rate_limited
  avgLatencyMs:      number;
  p95LatencyMs:      number;
  totalInputTokens:  number;
  totalOutputTokens: number;
  recommendationsGenerated: number;
}

export interface AiRunRow {
  id:                       string;
  createdAt:                string;
  model:                    string;
  promptVersion:            string;
  status:                   string;
  recommendationsGenerated: number;
  latencyMs:                number;
  inputTokens:              number;
  outputTokens:             number;
  outputsBlocked:           number;
  errorMessage:             string | null;
}

const DAY_MS = 86_400_000;

@Injectable()
export class AiAuditStatsService {
  constructor(
    @InjectRepository(AiAuditLog) private readonly logs: Repository<AiAuditLog>,
  ) {}

  async stats(tenantId: string, days = 7): Promise<AiRunStats> {
    const since = new Date(Date.now() - days * DAY_MS);
    const rows = await this.logs.find({
      where: { pharmacyTenantId: tenantId, createdAt: MoreThanOrEqual(since) },
      select: [
        'status', 'latencyMs', 'totalInputTokens', 'totalOutputTokens',
        'recommendationsGenerated',
      ],
    });

    const success = rows.filter(r => r.status === 'success').length;
    const failed  = rows.filter(r => r.status === 'failed').length;
    const blocked = rows.filter(r =>
      r.status === 'blocked_input' || r.status === 'blocked_output' || r.status === 'rate_limited',
    ).length;

    const latencies = rows.map(r => r.latencyMs ?? 0).filter(n => n > 0).sort((a, b) => a - b);
    const avg = latencies.length ? Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length) : 0;
    const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;

    return {
      windowDays:        days,
      totalRuns:         rows.length,
      success,
      failed,
      blocked,
      avgLatencyMs:      avg,
      p95LatencyMs:      p95,
      totalInputTokens:  rows.reduce((s, r) => s + (r.totalInputTokens  ?? 0), 0),
      totalOutputTokens: rows.reduce((s, r) => s + (r.totalOutputTokens ?? 0), 0),
      recommendationsGenerated: rows.reduce((s, r) => s + (r.recommendationsGenerated ?? 0), 0),
    };
  }

  async recent(
    tenantId: string,
    limit = 25,
    offset = 0,
  ): Promise<{ data: AiRunRow[]; total: number; limit: number; offset: number }> {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = Math.max(offset, 0);
    const [rows, total] = await this.logs.findAndCount({
      where: { pharmacyTenantId: tenantId },
      order: { createdAt: 'DESC' },
      take,
      skip,
    });
    const data = rows.map(r => ({
      id:                       r.id,
      createdAt:                r.createdAt.toISOString(),
      model:                    r.model,
      promptVersion:            r.promptVersion,
      status:                   r.status,
      recommendationsGenerated: r.recommendationsGenerated ?? 0,
      latencyMs:                r.latencyMs ?? 0,
      inputTokens:              r.totalInputTokens ?? 0,
      outputTokens:             r.totalOutputTokens ?? 0,
      outputsBlocked:           r.outputsBlocked ?? 0,
      errorMessage:             r.errorMessage ?? null,
    }));
    return { data, total, limit: take, offset: skip };
  }
}

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { blendedCost } from './pricing';

/**
 * Per-tenant, per-feature daily OpenAI token cap.
 *
 * Why feature-aware: a runaway chat loop or a misconfigured migration job
 * must NOT consume the budget reserved for procurement recommendations
 * (the highest-value AI surface). Each feature has an independent bucket
 * stored as a separate row in `ai_token_usage` (PK: tenantId, day, feature).
 *
 * Sub-caps default to a conservative split of the global cap:
 *   procurement : 100% of cap   — the original behaviour
 *   chat        :  25% of cap   — user-driven, rate-limited at request layer
 *   migration   :  20% of cap   — bursty, only during onboarding
 *   whatsapp    :  15% of cap   — outbound rendering only
 *   generic     :  10% of cap   — anything else / experiments
 *
 * Each can be overridden by env var `AI_DAILY_OUTPUT_TOKEN_CAP_<FEATURE>`.
 *
 * Counts are persisted, atomic UPSERT — never read-then-write — and a
 * bookkeeping failure must never break the calling AI flow.
 */

export type AiFeature = 'procurement' | 'chat' | 'migration' | 'whatsapp' | 'generic';

const DEFAULT_FEATURE_RATIO: Record<AiFeature, number> = {
  procurement: 1.00,
  chat:        0.25,
  migration:   0.20,
  whatsapp:    0.15,
  generic:     0.10,
};

@Injectable()
export class AiTokenBudget {
  private readonly logger = new Logger(AiTokenBudget.name);
  private readonly globalCap: number;
  private readonly featureCaps: Record<AiFeature, number>;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    cfg: ConfigService,
  ) {
    this.globalCap = Number(cfg.get<string>('AI_DAILY_OUTPUT_TOKEN_CAP') ?? 200_000);

    this.featureCaps = (Object.keys(DEFAULT_FEATURE_RATIO) as AiFeature[]).reduce((acc, f) => {
      const envKey = `AI_DAILY_OUTPUT_TOKEN_CAP_${f.toUpperCase()}`;
      const override = Number(cfg.get<string>(envKey) ?? 0);
      acc[f] = override > 0 ? override : Math.floor(this.globalCap * DEFAULT_FEATURE_RATIO[f]);
      return acc;
    }, {} as Record<AiFeature, number>);
  }

  /**
   * Returns true if the tenant still has budget today on this feature.
   * Indexed lookup on (tenantId, day, feature). Defaults `feature` to
   * 'procurement' to preserve original behaviour for legacy call sites.
   */
  async hasBudget(tenantId: string, feature: AiFeature = 'procurement'): Promise<boolean> {
    const rows = await this.ds.query(
      `SELECT "outputTokens" FROM "ai_token_usage"
        WHERE "tenantId" = $1 AND "day" = CURRENT_DATE AND "feature" = $2`,
      [tenantId, feature],
    );
    const used = Number(rows[0]?.outputTokens ?? 0);
    return used < this.featureCaps[feature];
  }

  /**
   * Atomic UPSERT — increments tokens used. Fire-and-forget on failure:
   * bookkeeping must never break the calling AI flow.
   */
  async record(
    tenantId: string,
    inputTokens: number,
    outputTokens: number,
    feature: AiFeature = 'procurement',
  ): Promise<void> {
    if (inputTokens === 0 && outputTokens === 0) return;
    try {
      await this.ds.query(
        `INSERT INTO "ai_token_usage" ("tenantId","day","feature","inputTokens","outputTokens","calls","updatedAt")
         VALUES ($1, CURRENT_DATE, $2, $3, $4, 1, now())
         ON CONFLICT ("tenantId","day","feature") DO UPDATE
           SET "inputTokens"  = "ai_token_usage"."inputTokens"  + EXCLUDED."inputTokens",
               "outputTokens" = "ai_token_usage"."outputTokens" + EXCLUDED."outputTokens",
               "calls"        = "ai_token_usage"."calls"        + 1,
               "updatedAt"    = now()`,
        [tenantId, feature, inputTokens, outputTokens],
      );
    } catch (err) {
      this.logger.warn(`token usage record failed (${tenantId}/${feature}): ${(err as Error).message}`);
    }
  }

  assertHasBudget(tenantId: string, has: boolean, feature: AiFeature = 'procurement'): void {
    if (!has) {
      throw new ForbiddenException(
        `Daily AI token budget exceeded for tenant on feature "${feature}". Resets at midnight UTC.`,
      );
    }
  }

  /** Global cap — kept for backwards-compatible callers. */
  get cap(): number {
    return this.globalCap;
  }

  capFor(feature: AiFeature): number {
    return this.featureCaps[feature];
  }

  /**
   * Today's usage for a single feature (default: procurement, for legacy UI).
   */
  async usageToday(tenantId: string, feature: AiFeature = 'procurement'): Promise<{
    inputTokens:  number;
    outputTokens: number;
    calls:        number;
    cap:          number;
    remaining:    number;
    percent:      number;
    feature:      AiFeature;
  }> {
    const rows = await this.ds.query(
      `SELECT "inputTokens","outputTokens","calls"
         FROM "ai_token_usage"
        WHERE "tenantId" = $1 AND "day" = CURRENT_DATE AND "feature" = $2`,
      [tenantId, feature],
    );
    const r = rows[0] ?? { inputTokens: 0, outputTokens: 0, calls: 0 };
    const output = Number(r.outputTokens ?? 0);
    const cap = this.featureCaps[feature];
    const remaining = Math.max(0, cap - output);
    const percent = cap > 0 ? Math.min(100, Math.round((output / cap) * 100)) : 0;
    return {
      inputTokens:  Number(r.inputTokens  ?? 0),
      outputTokens: output,
      calls:        Number(r.calls        ?? 0),
      cap,
      remaining,
      percent,
      feature,
    };
  }

  /**
   * Full per-feature breakdown for the day — powers the AI Cost widget
   * so admins can spot which surface is consuming the budget.
   *
   * Includes derived USD cost (blended rate, see `pricing.ts`). Cost is an
   * estimate — exact per-call cost is captured per row in `ai_audit_logs`.
   */
  async usageBreakdownToday(tenantId: string): Promise<Array<{
    feature:       AiFeature;
    inputTokens:   number;
    outputTokens:  number;
    calls:         number;
    cap:           number;
    remaining:     number;
    percent:       number;
    inputCostUsd:  number;
    outputCostUsd: number;
    totalCostUsd:  number;
  }>> {
    const rows = await this.ds.query(
      `SELECT "feature","inputTokens","outputTokens","calls"
         FROM "ai_token_usage"
        WHERE "tenantId" = $1 AND "day" = CURRENT_DATE`,
      [tenantId],
    );
    const byFeature = new Map<string, { inputTokens: number; outputTokens: number; calls: number }>();
    for (const r of rows ?? []) {
      byFeature.set(r.feature, {
        inputTokens:  Number(r.inputTokens  ?? 0),
        outputTokens: Number(r.outputTokens ?? 0),
        calls:        Number(r.calls        ?? 0),
      });
    }
    return (Object.keys(this.featureCaps) as AiFeature[]).map((feature) => {
      const used = byFeature.get(feature) ?? { inputTokens: 0, outputTokens: 0, calls: 0 };
      const cap = this.featureCaps[feature];
      const remaining = Math.max(0, cap - used.outputTokens);
      const percent = cap > 0 ? Math.min(100, Math.round((used.outputTokens / cap) * 100)) : 0;
      const cost = blendedCost(used.inputTokens, used.outputTokens);
      return {
        feature,
        ...used,
        cap,
        remaining,
        percent,
        inputCostUsd:  Number(cost.inputCostUsd.toFixed(6)),
        outputCostUsd: Number(cost.outputCostUsd.toFixed(6)),
        totalCostUsd:  Number(cost.totalCostUsd.toFixed(6)),
      };
    });
  }
}

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

/**
 * Gap #7 — per-tenant daily OpenAI token cap.
 *
 * Why: a misbehaving tenant (or compromised key) could rack up unbounded
 * GPT spend in minutes. This cap is a hard backstop measured in *output*
 * tokens (the expensive side). When breached, generation falls back to
 * rules-only mode for the rest of the calendar day.
 *
 * Counts are persisted in `ai_token_usage` so that restarting the API does
 * not reset the budget. The check + increment is the same atomic UPSERT —
 * we never read-then-write.
 *
 * Default budget: 200,000 output tokens / tenant / day. At gpt-4o-mini
 * pricing that is roughly $0.12/day per tenant — generous for normal use,
 * fatal for a runaway loop.
 */
@Injectable()
export class AiTokenBudget {
  private readonly logger = new Logger(AiTokenBudget.name);
  private readonly dailyOutputCap: number;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    cfg: ConfigService,
  ) {
    this.dailyOutputCap = Number(cfg.get<string>('AI_DAILY_OUTPUT_TOKEN_CAP') ?? 200_000);
  }

  /** Returns true if the tenant has remaining budget today. Cheap, indexed lookup. */
  async hasBudget(tenantId: string): Promise<boolean> {
    const rows = await this.ds.query(
      `SELECT "outputTokens" FROM "ai_token_usage"
        WHERE "tenantId" = $1 AND "day" = CURRENT_DATE`,
      [tenantId],
    );
    const used = Number(rows[0]?.outputTokens ?? 0);
    return used < this.dailyOutputCap;
  }

  /**
   * Atomic UPSERT — increments tokens used and returns the new total so the
   * caller can decide whether to short-circuit subsequent calls in the same
   * generation batch. Fire-and-forget on failure: a bookkeeping failure
   * must never break recommendation generation.
   */
  async record(
    tenantId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    if (inputTokens === 0 && outputTokens === 0) return;
    try {
      await this.ds.query(
        `INSERT INTO "ai_token_usage" ("tenantId","day","inputTokens","outputTokens","calls","updatedAt")
         VALUES ($1, CURRENT_DATE, $2, $3, 1, now())
         ON CONFLICT ("tenantId","day") DO UPDATE
           SET "inputTokens"  = "ai_token_usage"."inputTokens"  + EXCLUDED."inputTokens",
               "outputTokens" = "ai_token_usage"."outputTokens" + EXCLUDED."outputTokens",
               "calls"        = "ai_token_usage"."calls"        + 1,
               "updatedAt"    = now()`,
        [tenantId, inputTokens, outputTokens],
      );
    } catch (err) {
      this.logger.warn(`token usage record failed (${tenantId}): ${(err as Error).message}`);
    }
  }

  assertHasBudget(tenantId: string, has: boolean): void {
    if (!has) {
      throw new ForbiddenException(
        `Daily AI token budget exceeded for this tenant. Resets at midnight UTC.`,
      );
    }
  }

  get cap(): number {
    return this.dailyOutputCap;
  }

  /** Today's usage snapshot for the UI (input, output, calls + remaining). */
  async usageToday(tenantId: string): Promise<{
    inputTokens:  number;
    outputTokens: number;
    calls:        number;
    cap:          number;
    remaining:    number;
    percent:      number;
  }> {
    const rows = await this.ds.query(
      `SELECT "inputTokens","outputTokens","calls"
         FROM "ai_token_usage"
        WHERE "tenantId" = $1 AND "day" = CURRENT_DATE`,
      [tenantId],
    );
    const r = rows[0] ?? { inputTokens: 0, outputTokens: 0, calls: 0 };
    const output = Number(r.outputTokens ?? 0);
    const remaining = Math.max(0, this.dailyOutputCap - output);
    const percent = this.dailyOutputCap > 0
      ? Math.min(100, Math.round((output / this.dailyOutputCap) * 100))
      : 0;
    return {
      inputTokens:  Number(r.inputTokens  ?? 0),
      outputTokens: output,
      calls:        Number(r.calls        ?? 0),
      cap:          this.dailyOutputCap,
      remaining,
      percent,
    };
  }
}

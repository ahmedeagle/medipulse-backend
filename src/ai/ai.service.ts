import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import OpenAI from 'openai';

import { AiRecommendation } from './entities/ai-recommendation.entity';
import { AiAuditLog } from './entities/ai-audit-log.entity';
import { RecommendationDecisionTrace } from './entities/recommendation-decision-trace.entity';
import { InventoryService } from '../inventory/inventory.service';
import { SupplierService } from '../supplier/supplier.service';
import { SupplierReliabilityService } from '../supplier/supplier-reliability.service';
import { ConsumptionAnalyticsService } from '../inventory/consumption-analytics.service';
import { DemandForecastingService } from '../forecasting/demand-forecasting.service';
import { EoqService } from '../forecasting/eoq.service';
import { RulesEngine, RawRecommendation } from './rules.engine';
import { RecommendationType } from '../common/enums/recommendation-type.enum';
import { Order } from '../orders/entities/order.entity';

import { InputGuard } from './governance/input-guard';
import { OutputGuard } from './governance/output-guard';
import { ConfidenceEngine } from './governance/confidence.engine';
import { AiRateLimiter } from './governance/rate-limiter';
import { AiTokenBudget } from './governance/token-budget';
import { getSystemPrompt, CURRENT_PROMPT_VERSION } from './governance/system-prompt';
import { DynamicAgentRunner } from './governance/dynamic-agent-runner';
import { AI_GENERATE_JOB, AI_RECOMMENDATIONS_QUEUE } from './ai.constants';
import {
  RecommendationGeneratedEvent,
  StockRiskDetectedEvent,
  AiGovernanceBlockedEvent,
  RecommendationDismissedEvent,
  EVENTS,
} from '../events/domain-events';

/**
 * Pinned model version — never use a bare alias like "gpt-4o-mini".
 * OpenAI silently updates aliases; pinning gives reproducible behaviour
 * and makes prompt-version → model-version traceability explicit in audit logs.
 *
 * To upgrade: bump this constant + bump CURRENT_PROMPT_VERSION in system-prompt.ts
 */
const AI_MODEL = 'gpt-4o-mini-2024-07-18';

/** Hard timeout per OpenAI call — prevents a hung call from blocking a worker slot forever */
const GPT_TIMEOUT_MS = 15_000;

/** BullMQ job options — retry with exponential backoff, then move to failed set */
const JOB_OPTIONS = {
  attempts:         3,
  backoff:          { type: 'exponential' as const, delay: 5_000 }, // 5s → 10s → 20s
  removeOnComplete: { age: 3_600,  count: 1_000 },  // keep 1h or 1000 completed jobs
  removeOnFail:     { age: 86_400, count:   500 },  // keep 24h or 500 failed jobs
};

export interface EnqueueResult {
  jobId: string;
  status: 'queued';
}

export interface JobStatusResult {
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  recommendations?: AiRecommendation[];
  error?: string;
  attempts?: number;
  progress?: number;
}

@Injectable()
export class AiService {
  private readonly openai: OpenAI | null;
  /** True when OPENAI_API_KEY is missing or invalid — system runs in rules-only fallback mode */
  private readonly aiDegraded: boolean;
  private readonly rulesEngine    = new RulesEngine();
  private readonly inputGuard     = new InputGuard();
  private readonly outputGuard    = new OutputGuard();
  private readonly confidenceEngine = new ConfidenceEngine();
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectRepository(AiRecommendation)
    private recommendationRepo: Repository<AiRecommendation>,
    @InjectRepository(AiAuditLog)
    private auditLogRepo: Repository<AiAuditLog>,
    @InjectRepository(RecommendationDecisionTrace)
    private traceRepo: Repository<RecommendationDecisionTrace>,
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    @Inject(forwardRef(() => InventoryService))
    private inventoryService: InventoryService,
    private supplierService: SupplierService,
    private supplierReliabilityService: SupplierReliabilityService,
    private consumptionAnalyticsService: ConsumptionAnalyticsService,
    private demandForecastingService: DemandForecastingService,
    private eoqService: EoqService,
    private configService: ConfigService,
    private readonly rateLimiter: AiRateLimiter,
    private readonly tokenBudget: AiTokenBudget,
    private readonly eventEmitter: EventEmitter2,
    private readonly dynamicAgent: DynamicAgentRunner,
    @InjectQueue(AI_RECOMMENDATIONS_QUEUE)
    private readonly queue: Queue,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      // Gap #3: degrade gracefully — don't crash the entire module on boot.
      // Rules engine still ships recommendations with deterministic fallback explanations.
      this.logger.warn('OPENAI_API_KEY is not configured — AI explanations will use rules-only fallback');
      this.openai = null;
      this.aiDegraded = true;
    } else {
      this.openai = new OpenAI({ apiKey, timeout: GPT_TIMEOUT_MS });
      this.aiDegraded = false;
    }
  }

  // ─── Enqueue ──────────────────────────────────────────────────────────────

  async enqueueGeneration(
    pharmacyTenantId: string,
    userId: string,
  ): Promise<EnqueueResult> {
    // Rate-limit check happens here (HTTP context) before the job enters the queue
    await this.rateLimiter.assertAllowed(pharmacyTenantId);

    const job = await this.queue.add(
      AI_GENERATE_JOB,
      { tenantId: pharmacyTenantId, userId },
      JOB_OPTIONS,
    );

    return { jobId: job.id, status: 'queued' };
  }

  // ─── Job status polling ───────────────────────────────────────────────────

  async getJobStatus(
    pharmacyTenantId: string,
    jobId: string,
  ): Promise<JobStatusResult> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    // Security: a pharmacy can only poll its own jobs
    if (job.data.tenantId !== pharmacyTenantId) {
      throw new ForbiddenException('Access denied');
    }

    const state = await job.getState();

    if (state === 'completed') {
      return { jobId, status: 'completed', recommendations: job.returnvalue };
    }

    if (state === 'failed') {
      return {
        jobId,
        status: 'failed',
        error: job.failedReason,
        attempts: job.attemptsMade,
      };
    }

    const mapped = (['waiting', 'active', 'delayed'] as const).includes(state as any)
      ? (state as 'waiting' | 'active' | 'delayed')
      : 'unknown';

    return {
      jobId,
      status: mapped,
      progress: typeof job.progress === 'number' ? job.progress : 0,
    };
  }

  // ─── Core generation — called by AiGenerationProcessor ───────────────────

  async runGeneration(
    pharmacyTenantId: string,
    userId: string,
  ): Promise<AiRecommendation[]> {
    const startMs = Date.now();

    const audit = this.auditLogRepo.create({
      pharmacyTenantId,
      triggeredByUserId: userId,
      model: AI_MODEL,
      promptVersion: CURRENT_PROMPT_VERSION,
      status: 'failed',
      rulesTriggered: [],
    });

    try {
      // 1. Fetch data in parallel
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);

      const inventoryItems = await this.inventoryService.findAllForTenant(pharmacyTenantId);
      const pharmacyProductIds = inventoryItems.map((i) => i.productId);

      const [allCatalog, recentOrders] = await Promise.all([
        // Scoped to only products in this pharmacy's inventory — not the entire network catalog
        this.supplierService.findCatalogForPharmacy(pharmacyProductIds),
        this.orderRepo
          .createQueryBuilder('o')
          .innerJoinAndSelect('o.items', 'item')
          .where('o.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
          .andWhere('o.createdAt >= :since', { since: ninetyDaysAgo })
          .andWhere("o.status IN ('delivered', 'shipped', 'accepted')")
          .getMany(),
      ]);

      const orderHistory = recentOrders.flatMap((o) =>
        o.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          createdAt: o.createdAt,
        })),
      );

      const historyDays = recentOrders.length > 0
        ? Math.min(90, Math.ceil(
            (Date.now() - Math.min(...recentOrders.map((o) => o.createdAt.getTime()))) / 86_400_000,
          ))
        : 0;

      // 2. Fetch all intelligence context in parallel
      const supplierIds  = [...new Set((allCatalog as any[]).map((c) => c.supplierTenantId as string))];
      const productIds   = inventoryItems.map((i) => i.productId);

      const [supplierScores, consumptionSnapshots, forecastMap, scheduleMap] =
        await Promise.all([
          this.supplierReliabilityService.getScores(supplierIds),
          Promise.all(
            inventoryItems.map((item) =>
              this.consumptionAnalyticsService
                .getSnapshots(pharmacyTenantId, item.productId, 8)
                .then((s) => [item.productId, s] as [string, any[]]),
            ),
          ).then((pairs) => new Map(pairs)),
          this.demandForecastingService.getForecastMap(pharmacyTenantId, productIds, 14),
          this.eoqService.getScheduleMap(pharmacyTenantId, productIds),
        ]);

      // 3. Rules engine — enriched with reliability + consumption + forecast + EOQ
      const rawRecs = this.rulesEngine.generateRecommendations(
        inventoryItems,
        allCatalog,
        orderHistory,
        {
          supplierScores,
          consumptionData: consumptionSnapshots,
          forecastData:    forecastMap,
          scheduleData:    scheduleMap,
        },
      );

      audit.rulesTriggered = [...new Set(rawRecs.map((r) => r.type))];

      // Dismiss existing active recommendations — pharmacy always sees a fresh set
      await this.recommendationRepo
        .createQueryBuilder()
        .update()
        .set({ isDismissed: true })
        .where('pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
        .andWhere('isDismissed = false')
        .execute();

      if (rawRecs.length === 0) {
        audit.status = 'success';
        audit.recommendationsGenerated = 0;
        audit.latencyMs = Date.now() - startMs;
        await this.auditLogRepo.save(audit);
        return [];
      }

      // 3. Build all GPT explanations in parallel — not sequentially.
      //    10 sequential calls × ~3s each = 30s. Parallel = ~3s total.
      const explanationResults = await Promise.all(
        rawRecs.map((raw) => this.buildExplanation(raw, pharmacyTenantId)),
      );

      const totalInputTokens  = explanationResults.reduce((s, r) => s + r.inputTokens,  0);
      const totalOutputTokens = explanationResults.reduce((s, r) => s + r.outputTokens, 0);
      const outputsBlocked    = explanationResults.filter((r) => r.blocked).length;

      // 4. Persist all recommendations (sequential — avoid DB write contention)
      const saved: AiRecommendation[] = [];

      for (let i = 0; i < rawRecs.length; i++) {
        const raw = rawRecs[i];
        const { explanation, fromGpt, promptVersion: resolvedPromptVersion } = explanationResults[i];

        const suppliersAvailable = (allCatalog as any[]).filter(
          (c) => c.productId === raw.productId && c.isAvailable,
        ).length;

        const confidence = this.confidenceEngine.compute({
          historyDays,
          trend: raw.payload?.demand?.trend ?? 'stable',
          seasonalMultiplier: raw.payload?.seasonality?.multiplier ?? 0,
          suppliersAvailable,
          currentQuantity: raw.payload?.currentQuantity ?? 0,
          minThreshold: raw.payload?.minThreshold ?? 0,
        });

        const entity = this.recommendationRepo.create({
          pharmacyTenantId,
          type: raw.type,
          productId: raw.productId,
          payload: raw.payload,
          explanation,
          explanationFromGpt: fromGpt,
          riskLevel: raw.riskLevel,
          confidence: confidence.score,
          confidenceLabel: confidence.label,
          rulesTriggered: [raw.type],
          isDismissed: false,
          // Gap #5 — reproducibility: stamp model + prompt version on the row itself.
          // PRD §13 — when a custom AgentDefinition is active, promptVersion will be
          // "agent:<code>@v<N>" so auditors can pull the exact prompt snapshot used.
          modelVersion:  fromGpt ? AI_MODEL : null,
          promptVersion: fromGpt ? resolvedPromptVersion : null,
        });

        const result = await this.recommendationRepo.save(entity);
        const withRelations = await this.recommendationRepo.findOne({
          where: { id: result.id },
          relations: ['product'],
        });
        saved.push(withRelations);

        // Save decision trace — the full explainability audit trail
        this.traceRepo.save(this.traceRepo.create({
          recommendationId: result.id,
          tenantId:         pharmacyTenantId,
          rulesEvaluated:   [{ rule: raw.type, triggered: true, contribution: `riskLevel=${raw.riskLevel}` }],
          supplierScoresConsidered: supplierScores.size > 0
            ? Array.from(supplierScores.entries()).map(([sid, s], idx) => ({
                supplierTenantId: sid,
                score:            Number(s.overallScore),
                rank:             idx + 1,
                wasSelected:      raw.payload?.recommendedSupplier?.tenantId === sid,
              }))
            : [],
          forecastUsed: forecastMap.get(raw.productId)
            ? {
                algorithm:      forecastMap.get(raw.productId)!.algorithm,
                forecastedQty:  Number(forecastMap.get(raw.productId)!.forecastedQty),
                confidence:     Number(forecastMap.get(raw.productId)!.confidenceIntervalHigh ?? 0),
                horizonDays:    forecastMap.get(raw.productId)!.horizonDays,
                trainingPoints: forecastMap.get(raw.productId)!.trainingDataPoints,
              }
            : null,
          seasonalSignal: raw.payload?.seasonality
            ? {
                event:      raw.payload.seasonality.event,
                source:     raw.payload.seasonality.source ?? 'none',
                multiplier: raw.payload.seasonality.multiplier,
                category:   raw.payload?.productName ?? '',
              }
            : null,
          eoqUsed: raw.payload?.eoq ?? null,
          finalRiskLevel:     raw.riskLevel,
          confidenceScore:    confidence.score,
          confidenceLabel:    confidence.label,
          explanationFromGpt: fromGpt,
        })).catch((err) => {
          // Gap #1 — don't silently drop the trace; we need to know if explainability is failing.
          this.logger.warn(`decision trace save failed (${result.id}): ${(err as Error).message}`);
        });
      }

      audit.status = 'success';
      audit.recommendationsGenerated = saved.length;
      audit.totalInputTokens = totalInputTokens;
      audit.totalOutputTokens = totalOutputTokens;
      audit.outputsBlocked = outputsBlocked;
      audit.latencyMs = Date.now() - startMs;

      await this.auditLogRepo.save(audit);

      // Emit domain events for each saved recommendation
      for (const rec of saved) {
        this.eventEmitter.emit(
          EVENTS.RECOMMENDATION_GENERATED,
          new RecommendationGeneratedEvent(
            pharmacyTenantId,
            rec.id,
            rec.type,
            rec.riskLevel as 'HIGH' | 'MEDIUM' | 'LOW',
            Number(rec.confidence),
          ),
        );
        if (rec.riskLevel === 'HIGH') {
          this.eventEmitter.emit(
            EVENTS.STOCK_RISK_DETECTED,
            new StockRiskDetectedEvent(
              pharmacyTenantId,
              rec.productId,
              'HIGH',
              rec.payload?.stockDays ?? 0,
              rec.payload?.suggestedReorderQty ?? 0,
            ),
          );
        }
      }

      return saved;
    } catch (error: any) {
      audit.status = error?.status === 429 ? 'rate_limited' : 'failed';
      audit.errorMessage = error?.message ?? 'Unknown error';
      audit.latencyMs = Date.now() - startMs;
      await this.auditLogRepo.save(audit);
      throw error;
    }
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async getRecommendations(pharmacyTenantId: string): Promise<AiRecommendation[]> {
    return this.recommendationRepo
      .createQueryBuilder('rec')
      .leftJoinAndSelect('rec.product', 'product')
      .where('rec.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
      .andWhere('rec.isDismissed = false')
      .orderBy("CASE rec.riskLevel WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END", 'ASC')
      .addOrderBy('rec.createdAt', 'DESC')
      .getMany();
  }

  // ─── Dismiss ──────────────────────────────────────────────────────────────

  async dismiss(pharmacyTenantId: string, id: string): Promise<AiRecommendation> {
    await this.findOwnedRec(pharmacyTenantId, id);
    await this.recommendationRepo.update(id, { isDismissed: true });
    this.eventEmitter.emit(
      EVENTS.RECOMMENDATION_DISMISSED,
      new RecommendationDismissedEvent(pharmacyTenantId, id, null),
    );
    return this.recommendationRepo.findOne({ where: { id }, relations: ['product'] });
  }

  // ─── Feedback ─────────────────────────────────────────────────────────────

  async submitFeedback(
    pharmacyTenantId: string,
    id: string,
    score: 1 | -1,
    note?: string,
  ): Promise<AiRecommendation> {
    if (score !== 1 && score !== -1) {
      throw new BadRequestException('Feedback score must be 1 (helpful) or -1 (not helpful)');
    }
    await this.findOwnedRec(pharmacyTenantId, id);
    await this.recommendationRepo.update(id, {
      feedbackScore: score,
      feedbackNote: note ?? null,
    });
    return this.recommendationRepo.findOne({ where: { id }, relations: ['product'] });
  }

  // ─── Admin: audit logs ────────────────────────────────────────────────────

  async getAuditLogs(pharmacyTenantId: string): Promise<AiAuditLog[]> {
    return this.auditLogRepo.find({
      where: { pharmacyTenantId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async buildExplanation(
    raw: RawRecommendation,
    tenantId: string,
  ): Promise<{
    explanation: string;
    fromGpt: boolean;
    inputTokens: number;
    outputTokens: number;
    blocked: boolean;
    promptVersion: string;
  }> {
    // Gap #3 — if no API key configured, ship the rules-only fallback. The
    // recommendation still goes out; only the explanation is deterministic.
    if (this.aiDegraded || !this.openai) {
      return {
        explanation: this.fallbackExplanation(raw),
        fromGpt: false, inputTokens: 0, outputTokens: 0, blocked: false,
        promptVersion: CURRENT_PROMPT_VERSION,
      };
    }

    // Gap #7 — hard daily token cap per tenant. When breached, fall back to
    // the deterministic explanation for the rest of the day.
    if (!(await this.tokenBudget.hasBudget(tenantId))) {
      this.logger.warn(`[${tenantId}] daily AI token budget exhausted — using rules-only fallback`);
      return {
        explanation: this.fallbackExplanation(raw),
        fromGpt: false, inputTokens: 0, outputTokens: 0, blocked: false,
        promptVersion: CURRENT_PROMPT_VERSION,
      };
    }

    const prompt = this.buildPrompt(raw);

    // PRD §13 Phase 4a-2 — DynamicAgent: if an admin has set a custom Arabic
    // prompt for `inventory_expert` (the agent that owns reorder narration),
    // use it and stamp `agent:<code>@v<N>` on the row. Otherwise fall back to
    // the locked legacy prompt.
    const dynamic = await this.dynamicAgent.resolve(tenantId, 'inventory_expert');
    const systemPromptText = dynamic?.systemPrompt ?? getSystemPrompt('recommendation');
    const resolvedPromptVersion = dynamic?.promptVersion ?? CURRENT_PROMPT_VERSION;

    const inputCheck = this.inputGuard.validate(prompt);
    if (!inputCheck.safe) {
      this.logger.warn(`[${tenantId}] InputGuard blocked: ${inputCheck.reason}`);
      this.eventEmitter.emit(
        EVENTS.AI_GOVERNANCE_BLOCKED,
        new AiGovernanceBlockedEvent(tenantId, 'input', inputCheck.reason, resolvedPromptVersion),
      );
      return {
        explanation: this.fallbackExplanation(raw),
        fromGpt: false,
        inputTokens: 0,
        outputTokens: 0,
        blocked: true,
        promptVersion: resolvedPromptVersion,
      };
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPromptText },
          { role: 'user', content: prompt },
        ],
        max_tokens: 180,   // 120 was too tight for 2 sentences with specific numbers
        temperature: 0.3,
      });

      const rawOutput = response.choices[0]?.message?.content ?? '';
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      // Gap #7 — record token usage atomically (fire-and-forget; never blocks).
      void this.tokenBudget.record(tenantId, inputTokens, outputTokens);

      const safeOutput = this.outputGuard.assertSafe(rawOutput);
      if (!safeOutput) {
        this.logger.warn(`[${tenantId}] OutputGuard blocked GPT response`);
        this.eventEmitter.emit(
          EVENTS.AI_GOVERNANCE_BLOCKED,
          new AiGovernanceBlockedEvent(tenantId, 'output', 'OutputGuard rejected response', resolvedPromptVersion),
        );
        return {
          explanation: this.fallbackExplanation(raw),
          fromGpt: false,
          inputTokens,
          outputTokens,
          blocked: true,
          promptVersion: resolvedPromptVersion,
        };
      }

      return {
        explanation: safeOutput,
        fromGpt: true,
        inputTokens,
        outputTokens,
        blocked: false,
        promptVersion: resolvedPromptVersion,
      };
    } catch (error) {
      // Gap detection: OpenAI 429 means we're being rate-limited — don't burn
      // BullMQ retry budget hammering them. Just fall back deterministically.
      const status = (error as any)?.status ?? (error as any)?.response?.status;
      if (status === 429) {
        this.logger.warn(`OpenAI rate-limited (${raw.type}) — using rules-only fallback`);
      } else {
        this.logger.warn(`OpenAI call failed (${raw.type}): ${(error as Error).message}`);
      }
      return {
        explanation: this.fallbackExplanation(raw),
        fromGpt: false,
        inputTokens: 0,
        outputTokens: 0,
        blocked: false,
        promptVersion: resolvedPromptVersion,
      };
    }
  }

  private buildPrompt(raw: RawRecommendation): string {
    const name = this.inputGuard.sanitizeField(raw.payload?.productName ?? '', 'productName');

    switch (raw.type) {
      case RecommendationType.REORDER: {
        const { currentQuantity, minThreshold, stockDays, suggestedReorderQty, demand, seasonality } = raw.payload;
        const trendNote = demand?.trend !== 'stable' ? ` Demand is trending ${demand.trend}.` : '';
        const seasonNote = seasonality?.adjustmentApplied
          ? ` It is ${seasonality.season} — seasonal demand increase of ${Math.round(seasonality.multiplier * 100)}% was applied.`
          : '';
        return (
          `Product "${name}" has ${currentQuantity} units remaining (threshold: ${minThreshold}).` +
          ` Estimated stock lasts ~${stockDays} days.${trendNote}${seasonNote}` +
          ` Suggested reorder: ${suggestedReorderQty} units. Risk: ${raw.riskLevel}.`
        );
      }

      case RecommendationType.PRICE_COMPARISON: {
        const { options, cheapestSupplier, maxSavings } = raw.payload;
        const expensive = options[options.length - 1];
        return (
          `"${name}" is available from ${options.length} suppliers.` +
          ` Cheapest: ${cheapestSupplier} at ${options[0].price} ${options[0].currency} (saves ${maxSavings}% vs ${expensive.supplierName} at ${expensive.price} ${expensive.currency}).`
        );
      }

      case RecommendationType.ALTERNATIVE: {
        const { genericName, alternatives } = raw.payload;
        const altList = alternatives
          .slice(0, 2)
          .map((a: any) => `"${this.inputGuard.sanitizeField(a.productName, 'altName')}" (${a.supplierCount} supplier${a.supplierCount !== 1 ? 's' : ''})`)
          .join(' and ');
        return (
          `"${name}" (generic: ${genericName}) is unavailable from all suppliers.` +
          ` Same-generic alternatives available: ${altList}.`
        );
      }

      default:
        return `Procurement signal: ${JSON.stringify(raw.payload).slice(0, 300)}`;
    }
  }

  private fallbackExplanation(raw: RawRecommendation): string {
    switch (raw.type) {
      case RecommendationType.REORDER: {
        const { productName, currentQuantity, minThreshold, stockDays, suggestedReorderQty } = raw.payload;
        return `"${productName}" is at ${currentQuantity} units (threshold: ${minThreshold}) — ~${stockDays} days remaining. Recommended reorder: ${suggestedReorderQty} units. Risk: ${raw.riskLevel}.`;
      }
      case RecommendationType.PRICE_COMPARISON: {
        const { productName, options } = raw.payload;
        return `"${productName}" is available from ${options.length} suppliers — ${options[0]?.supplierName} offers the best price with ${options[0]?.savings}% savings.`;
      }
      case RecommendationType.ALTERNATIVE: {
        const { unavailableProductName, alternatives } = raw.payload;
        return `"${unavailableProductName}" is unavailable from all suppliers. ${alternatives.length} alternative(s) with the same active ingredient are available.`;
      }
      default:
        return 'A procurement recommendation is available for your pharmacy.';
    }
  }

  private async findOwnedRec(tenantId: string, id: string): Promise<AiRecommendation> {
    const rec = await this.recommendationRepo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException(`Recommendation ${id} not found`);
    if (rec.pharmacyTenantId !== tenantId) throw new ForbiddenException('Access denied');
    return rec;
  }
}

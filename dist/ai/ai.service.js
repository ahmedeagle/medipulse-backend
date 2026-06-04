"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const event_emitter_1 = require("@nestjs/event-emitter");
const openai_1 = require("openai");
const ai_recommendation_entity_1 = require("./entities/ai-recommendation.entity");
const ai_audit_log_entity_1 = require("./entities/ai-audit-log.entity");
const recommendation_decision_trace_entity_1 = require("./entities/recommendation-decision-trace.entity");
const inventory_service_1 = require("../inventory/inventory.service");
const supplier_service_1 = require("../supplier/supplier.service");
const supplier_reliability_service_1 = require("../supplier/supplier-reliability.service");
const consumption_analytics_service_1 = require("../inventory/consumption-analytics.service");
const demand_forecasting_service_1 = require("../forecasting/demand-forecasting.service");
const eoq_service_1 = require("../forecasting/eoq.service");
const rules_engine_1 = require("./rules.engine");
const recommendation_type_enum_1 = require("../common/enums/recommendation-type.enum");
const order_entity_1 = require("../orders/entities/order.entity");
const input_guard_1 = require("./governance/input-guard");
const output_guard_1 = require("./governance/output-guard");
const confidence_engine_1 = require("./governance/confidence.engine");
const rate_limiter_1 = require("./governance/rate-limiter");
const system_prompt_1 = require("./governance/system-prompt");
const ai_constants_1 = require("./ai.constants");
const domain_events_1 = require("../events/domain-events");
const AI_MODEL = 'gpt-4o-mini-2024-07-18';
const GPT_TIMEOUT_MS = 15_000;
const JOB_OPTIONS = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: { age: 86_400, count: 500 },
};
let AiService = AiService_1 = class AiService {
    constructor(recommendationRepo, auditLogRepo, traceRepo, orderRepo, inventoryService, supplierService, supplierReliabilityService, consumptionAnalyticsService, demandForecastingService, eoqService, configService, rateLimiter, eventEmitter, queue) {
        this.recommendationRepo = recommendationRepo;
        this.auditLogRepo = auditLogRepo;
        this.traceRepo = traceRepo;
        this.orderRepo = orderRepo;
        this.inventoryService = inventoryService;
        this.supplierService = supplierService;
        this.supplierReliabilityService = supplierReliabilityService;
        this.consumptionAnalyticsService = consumptionAnalyticsService;
        this.demandForecastingService = demandForecastingService;
        this.eoqService = eoqService;
        this.configService = configService;
        this.rateLimiter = rateLimiter;
        this.eventEmitter = eventEmitter;
        this.queue = queue;
        this.rulesEngine = new rules_engine_1.RulesEngine();
        this.inputGuard = new input_guard_1.InputGuard();
        this.outputGuard = new output_guard_1.OutputGuard();
        this.confidenceEngine = new confidence_engine_1.ConfidenceEngine();
        this.logger = new common_1.Logger(AiService_1.name);
        const apiKey = this.configService.get('OPENAI_API_KEY');
        if (!apiKey)
            throw new Error('OPENAI_API_KEY is not configured');
        this.openai = new openai_1.default({ apiKey, timeout: GPT_TIMEOUT_MS });
    }
    async enqueueGeneration(pharmacyTenantId, userId) {
        await this.rateLimiter.assertAllowed(pharmacyTenantId);
        const job = await this.queue.add(ai_constants_1.AI_GENERATE_JOB, { tenantId: pharmacyTenantId, userId }, JOB_OPTIONS);
        return { jobId: job.id, status: 'queued' };
    }
    async getJobStatus(pharmacyTenantId, jobId) {
        const job = await this.queue.getJob(jobId);
        if (!job)
            throw new common_1.NotFoundException(`Job ${jobId} not found`);
        if (job.data.tenantId !== pharmacyTenantId) {
            throw new common_1.ForbiddenException('Access denied');
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
        const mapped = ['waiting', 'active', 'delayed'].includes(state)
            ? state
            : 'unknown';
        return {
            jobId,
            status: mapped,
            progress: typeof job.progress === 'number' ? job.progress : 0,
        };
    }
    async runGeneration(pharmacyTenantId, userId) {
        const startMs = Date.now();
        const audit = this.auditLogRepo.create({
            pharmacyTenantId,
            triggeredByUserId: userId,
            model: AI_MODEL,
            promptVersion: system_prompt_1.CURRENT_PROMPT_VERSION,
            status: 'failed',
            rulesTriggered: [],
        });
        try {
            const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
            const inventoryItems = await this.inventoryService.findAll(pharmacyTenantId);
            const pharmacyProductIds = inventoryItems.map((i) => i.productId);
            const [allCatalog, recentOrders] = await Promise.all([
                this.supplierService.findCatalogForPharmacy(pharmacyProductIds),
                this.orderRepo
                    .createQueryBuilder('o')
                    .innerJoinAndSelect('o.items', 'item')
                    .where('o.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
                    .andWhere('o.createdAt >= :since', { since: ninetyDaysAgo })
                    .andWhere("o.status IN ('delivered', 'shipped', 'accepted')")
                    .getMany(),
            ]);
            const orderHistory = recentOrders.flatMap((o) => o.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                createdAt: o.createdAt,
            })));
            const historyDays = recentOrders.length > 0
                ? Math.min(90, Math.ceil((Date.now() - Math.min(...recentOrders.map((o) => o.createdAt.getTime()))) / 86_400_000))
                : 0;
            const supplierIds = [...new Set(allCatalog.map((c) => c.supplierTenantId))];
            const productIds = inventoryItems.map((i) => i.productId);
            const [supplierScores, consumptionSnapshots, forecastMap, scheduleMap] = await Promise.all([
                this.supplierReliabilityService.getScores(supplierIds),
                Promise.all(inventoryItems.map((item) => this.consumptionAnalyticsService
                    .getSnapshots(pharmacyTenantId, item.productId, 8)
                    .then((s) => [item.productId, s]))).then((pairs) => new Map(pairs)),
                this.demandForecastingService.getForecastMap(pharmacyTenantId, productIds, 14),
                this.eoqService.getScheduleMap(pharmacyTenantId, productIds),
            ]);
            const rawRecs = this.rulesEngine.generateRecommendations(inventoryItems, allCatalog, orderHistory, {
                supplierScores,
                consumptionData: consumptionSnapshots,
                forecastData: forecastMap,
                scheduleData: scheduleMap,
            });
            audit.rulesTriggered = [...new Set(rawRecs.map((r) => r.type))];
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
            const explanationResults = await Promise.all(rawRecs.map((raw) => this.buildExplanation(raw, pharmacyTenantId)));
            const totalInputTokens = explanationResults.reduce((s, r) => s + r.inputTokens, 0);
            const totalOutputTokens = explanationResults.reduce((s, r) => s + r.outputTokens, 0);
            const outputsBlocked = explanationResults.filter((r) => r.blocked).length;
            const saved = [];
            for (let i = 0; i < rawRecs.length; i++) {
                const raw = rawRecs[i];
                const { explanation, fromGpt } = explanationResults[i];
                const suppliersAvailable = allCatalog.filter((c) => c.productId === raw.productId && c.isAvailable).length;
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
                });
                const result = await this.recommendationRepo.save(entity);
                const withRelations = await this.recommendationRepo.findOne({
                    where: { id: result.id },
                    relations: ['product'],
                });
                saved.push(withRelations);
                this.traceRepo.save(this.traceRepo.create({
                    recommendationId: result.id,
                    tenantId: pharmacyTenantId,
                    rulesEvaluated: [{ rule: raw.type, triggered: true, contribution: `riskLevel=${raw.riskLevel}` }],
                    supplierScoresConsidered: supplierScores.size > 0
                        ? Array.from(supplierScores.entries()).map(([sid, s], idx) => ({
                            supplierTenantId: sid,
                            score: Number(s.overallScore),
                            rank: idx + 1,
                            wasSelected: raw.payload?.recommendedSupplier?.tenantId === sid,
                        }))
                        : [],
                    forecastUsed: forecastMap.get(raw.productId)
                        ? {
                            algorithm: forecastMap.get(raw.productId).algorithm,
                            forecastedQty: Number(forecastMap.get(raw.productId).forecastedQty),
                            confidence: Number(forecastMap.get(raw.productId).confidenceIntervalHigh ?? 0),
                            horizonDays: forecastMap.get(raw.productId).horizonDays,
                            trainingPoints: forecastMap.get(raw.productId).trainingDataPoints,
                        }
                        : null,
                    seasonalSignal: raw.payload?.seasonality
                        ? {
                            event: raw.payload.seasonality.event,
                            source: raw.payload.seasonality.source ?? 'none',
                            multiplier: raw.payload.seasonality.multiplier,
                            category: raw.payload?.productName ?? '',
                        }
                        : null,
                    eoqUsed: raw.payload?.eoq ?? null,
                    finalRiskLevel: raw.riskLevel,
                    confidenceScore: confidence.score,
                    confidenceLabel: confidence.label,
                    explanationFromGpt: fromGpt,
                })).catch(() => { });
            }
            audit.status = 'success';
            audit.recommendationsGenerated = saved.length;
            audit.totalInputTokens = totalInputTokens;
            audit.totalOutputTokens = totalOutputTokens;
            audit.outputsBlocked = outputsBlocked;
            audit.latencyMs = Date.now() - startMs;
            await this.auditLogRepo.save(audit);
            for (const rec of saved) {
                this.eventEmitter.emit(domain_events_1.EVENTS.RECOMMENDATION_GENERATED, new domain_events_1.RecommendationGeneratedEvent(pharmacyTenantId, rec.id, rec.type, rec.riskLevel, Number(rec.confidence)));
                if (rec.riskLevel === 'HIGH') {
                    this.eventEmitter.emit(domain_events_1.EVENTS.STOCK_RISK_DETECTED, new domain_events_1.StockRiskDetectedEvent(pharmacyTenantId, rec.productId, 'HIGH', rec.payload?.stockDays ?? 0, rec.payload?.suggestedReorderQty ?? 0));
                }
            }
            return saved;
        }
        catch (error) {
            audit.status = error?.status === 429 ? 'rate_limited' : 'failed';
            audit.errorMessage = error?.message ?? 'Unknown error';
            audit.latencyMs = Date.now() - startMs;
            await this.auditLogRepo.save(audit);
            throw error;
        }
    }
    async getRecommendations(pharmacyTenantId) {
        return this.recommendationRepo
            .createQueryBuilder('rec')
            .leftJoinAndSelect('rec.product', 'product')
            .where('rec.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
            .andWhere('rec.isDismissed = false')
            .orderBy("CASE rec.riskLevel WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END", 'ASC')
            .addOrderBy('rec.createdAt', 'DESC')
            .getMany();
    }
    async dismiss(pharmacyTenantId, id) {
        await this.findOwnedRec(pharmacyTenantId, id);
        await this.recommendationRepo.update(id, { isDismissed: true });
        this.eventEmitter.emit(domain_events_1.EVENTS.RECOMMENDATION_DISMISSED, new domain_events_1.RecommendationDismissedEvent(pharmacyTenantId, id, null));
        return this.recommendationRepo.findOne({ where: { id }, relations: ['product'] });
    }
    async submitFeedback(pharmacyTenantId, id, score, note) {
        if (score !== 1 && score !== -1) {
            throw new common_1.BadRequestException('Feedback score must be 1 (helpful) or -1 (not helpful)');
        }
        await this.findOwnedRec(pharmacyTenantId, id);
        await this.recommendationRepo.update(id, {
            feedbackScore: score,
            feedbackNote: note ?? null,
        });
        return this.recommendationRepo.findOne({ where: { id }, relations: ['product'] });
    }
    async getAuditLogs(pharmacyTenantId) {
        return this.auditLogRepo.find({
            where: { pharmacyTenantId },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }
    async buildExplanation(raw, tenantId) {
        const prompt = this.buildPrompt(raw);
        const inputCheck = this.inputGuard.validate(prompt);
        if (!inputCheck.safe) {
            this.logger.warn(`[${tenantId}] InputGuard blocked: ${inputCheck.reason}`);
            this.eventEmitter.emit(domain_events_1.EVENTS.AI_GOVERNANCE_BLOCKED, new domain_events_1.AiGovernanceBlockedEvent(tenantId, 'input', inputCheck.reason, system_prompt_1.CURRENT_PROMPT_VERSION));
            return {
                explanation: this.fallbackExplanation(raw),
                fromGpt: false,
                inputTokens: 0,
                outputTokens: 0,
                blocked: true,
            };
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: AI_MODEL,
                messages: [
                    { role: 'system', content: (0, system_prompt_1.getSystemPrompt)('recommendation') },
                    { role: 'user', content: prompt },
                ],
                max_tokens: 180,
                temperature: 0.3,
            });
            const rawOutput = response.choices[0]?.message?.content ?? '';
            const inputTokens = response.usage?.prompt_tokens ?? 0;
            const outputTokens = response.usage?.completion_tokens ?? 0;
            const safeOutput = this.outputGuard.assertSafe(rawOutput);
            if (!safeOutput) {
                this.logger.warn(`[${tenantId}] OutputGuard blocked GPT response`);
                this.eventEmitter.emit(domain_events_1.EVENTS.AI_GOVERNANCE_BLOCKED, new domain_events_1.AiGovernanceBlockedEvent(tenantId, 'output', 'OutputGuard rejected response', system_prompt_1.CURRENT_PROMPT_VERSION));
                return {
                    explanation: this.fallbackExplanation(raw),
                    fromGpt: false,
                    inputTokens,
                    outputTokens,
                    blocked: true,
                };
            }
            return { explanation: safeOutput, fromGpt: true, inputTokens, outputTokens, blocked: false };
        }
        catch (error) {
            this.logger.warn(`OpenAI call failed (${raw.type}): ${error.message}`);
            return {
                explanation: this.fallbackExplanation(raw),
                fromGpt: false,
                inputTokens: 0,
                outputTokens: 0,
                blocked: false,
            };
        }
    }
    buildPrompt(raw) {
        const name = this.inputGuard.sanitizeField(raw.payload?.productName ?? '', 'productName');
        switch (raw.type) {
            case recommendation_type_enum_1.RecommendationType.REORDER: {
                const { currentQuantity, minThreshold, stockDays, suggestedReorderQty, demand, seasonality } = raw.payload;
                const trendNote = demand?.trend !== 'stable' ? ` Demand is trending ${demand.trend}.` : '';
                const seasonNote = seasonality?.adjustmentApplied
                    ? ` It is ${seasonality.season} — seasonal demand increase of ${Math.round(seasonality.multiplier * 100)}% was applied.`
                    : '';
                return (`Product "${name}" has ${currentQuantity} units remaining (threshold: ${minThreshold}).` +
                    ` Estimated stock lasts ~${stockDays} days.${trendNote}${seasonNote}` +
                    ` Suggested reorder: ${suggestedReorderQty} units. Risk: ${raw.riskLevel}.`);
            }
            case recommendation_type_enum_1.RecommendationType.PRICE_COMPARISON: {
                const { options, cheapestSupplier, maxSavings } = raw.payload;
                const expensive = options[options.length - 1];
                return (`"${name}" is available from ${options.length} suppliers.` +
                    ` Cheapest: ${cheapestSupplier} at ${options[0].price} ${options[0].currency} (saves ${maxSavings}% vs ${expensive.supplierName} at ${expensive.price} ${expensive.currency}).`);
            }
            case recommendation_type_enum_1.RecommendationType.ALTERNATIVE: {
                const { genericName, alternatives } = raw.payload;
                const altList = alternatives
                    .slice(0, 2)
                    .map((a) => `"${this.inputGuard.sanitizeField(a.productName, 'altName')}" (${a.supplierCount} supplier${a.supplierCount !== 1 ? 's' : ''})`)
                    .join(' and ');
                return (`"${name}" (generic: ${genericName}) is unavailable from all suppliers.` +
                    ` Same-generic alternatives available: ${altList}.`);
            }
            default:
                return `Procurement signal: ${JSON.stringify(raw.payload).slice(0, 300)}`;
        }
    }
    fallbackExplanation(raw) {
        switch (raw.type) {
            case recommendation_type_enum_1.RecommendationType.REORDER: {
                const { productName, currentQuantity, minThreshold, stockDays, suggestedReorderQty } = raw.payload;
                return `"${productName}" is at ${currentQuantity} units (threshold: ${minThreshold}) — ~${stockDays} days remaining. Recommended reorder: ${suggestedReorderQty} units. Risk: ${raw.riskLevel}.`;
            }
            case recommendation_type_enum_1.RecommendationType.PRICE_COMPARISON: {
                const { productName, options } = raw.payload;
                return `"${productName}" is available from ${options.length} suppliers — ${options[0]?.supplierName} offers the best price with ${options[0]?.savings}% savings.`;
            }
            case recommendation_type_enum_1.RecommendationType.ALTERNATIVE: {
                const { unavailableProductName, alternatives } = raw.payload;
                return `"${unavailableProductName}" is unavailable from all suppliers. ${alternatives.length} alternative(s) with the same active ingredient are available.`;
            }
            default:
                return 'A procurement recommendation is available for your pharmacy.';
        }
    }
    async findOwnedRec(tenantId, id) {
        const rec = await this.recommendationRepo.findOne({ where: { id } });
        if (!rec)
            throw new common_1.NotFoundException(`Recommendation ${id} not found`);
        if (rec.pharmacyTenantId !== tenantId)
            throw new common_1.ForbiddenException('Access denied');
        return rec;
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(ai_recommendation_entity_1.AiRecommendation)),
    __param(1, (0, typeorm_1.InjectRepository)(ai_audit_log_entity_1.AiAuditLog)),
    __param(2, (0, typeorm_1.InjectRepository)(recommendation_decision_trace_entity_1.RecommendationDecisionTrace)),
    __param(3, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __param(13, (0, bullmq_1.InjectQueue)(ai_constants_1.AI_RECOMMENDATIONS_QUEUE)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        inventory_service_1.InventoryService,
        supplier_service_1.SupplierService,
        supplier_reliability_service_1.SupplierReliabilityService,
        consumption_analytics_service_1.ConsumptionAnalyticsService,
        demand_forecasting_service_1.DemandForecastingService,
        eoq_service_1.EoqService,
        config_1.ConfigService,
        rate_limiter_1.AiRateLimiter,
        event_emitter_1.EventEmitter2,
        bullmq_2.Queue])
], AiService);
//# sourceMappingURL=ai.service.js.map
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiRecommendation } from './entities/ai-recommendation.entity';
import { AiAuditLog } from './entities/ai-audit-log.entity';
import { RecommendationDecisionTrace } from './entities/recommendation-decision-trace.entity';
import { InventoryService } from '../inventory/inventory.service';
import { SupplierService } from '../supplier/supplier.service';
import { SupplierReliabilityService } from '../supplier/supplier-reliability.service';
import { ConsumptionAnalyticsService } from '../inventory/consumption-analytics.service';
import { DemandForecastingService } from '../forecasting/demand-forecasting.service';
import { EoqService } from '../forecasting/eoq.service';
import { Order } from '../orders/entities/order.entity';
import { AiRateLimiter } from './governance/rate-limiter';
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
export declare class AiService {
    private recommendationRepo;
    private auditLogRepo;
    private traceRepo;
    private orderRepo;
    private inventoryService;
    private supplierService;
    private supplierReliabilityService;
    private consumptionAnalyticsService;
    private demandForecastingService;
    private eoqService;
    private configService;
    private readonly rateLimiter;
    private readonly eventEmitter;
    private readonly queue;
    private readonly openai;
    private readonly rulesEngine;
    private readonly inputGuard;
    private readonly outputGuard;
    private readonly confidenceEngine;
    private readonly logger;
    constructor(recommendationRepo: Repository<AiRecommendation>, auditLogRepo: Repository<AiAuditLog>, traceRepo: Repository<RecommendationDecisionTrace>, orderRepo: Repository<Order>, inventoryService: InventoryService, supplierService: SupplierService, supplierReliabilityService: SupplierReliabilityService, consumptionAnalyticsService: ConsumptionAnalyticsService, demandForecastingService: DemandForecastingService, eoqService: EoqService, configService: ConfigService, rateLimiter: AiRateLimiter, eventEmitter: EventEmitter2, queue: Queue);
    enqueueGeneration(pharmacyTenantId: string, userId: string): Promise<EnqueueResult>;
    getJobStatus(pharmacyTenantId: string, jobId: string): Promise<JobStatusResult>;
    runGeneration(pharmacyTenantId: string, userId: string): Promise<AiRecommendation[]>;
    getRecommendations(pharmacyTenantId: string): Promise<AiRecommendation[]>;
    dismiss(pharmacyTenantId: string, id: string): Promise<AiRecommendation>;
    submitFeedback(pharmacyTenantId: string, id: string, score: 1 | -1, note?: string): Promise<AiRecommendation>;
    getAuditLogs(pharmacyTenantId: string): Promise<AiAuditLog[]>;
    private buildExplanation;
    private buildPrompt;
    private fallbackExplanation;
    private findOwnedRec;
}

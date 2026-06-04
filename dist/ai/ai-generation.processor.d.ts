import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AiService } from './ai.service';
import { AiRecommendation } from './entities/ai-recommendation.entity';
export interface GenerateJobData {
    tenantId: string;
    userId: string;
}
export declare class AiGenerationProcessor extends WorkerHost {
    private readonly aiService;
    private readonly logger;
    constructor(aiService: AiService);
    process(job: Job<GenerateJobData>): Promise<AiRecommendation[]>;
    onFailed(job: Job<GenerateJobData>, err: Error): void;
}

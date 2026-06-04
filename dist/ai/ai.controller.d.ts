import { AiService } from './ai.service';
declare class FeedbackDto {
    score: 1 | -1;
    note?: string;
}
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiService);
    getRecommendations(user: any): Promise<import("./entities/ai-recommendation.entity").AiRecommendation[]>;
    enqueueGeneration(user: any): Promise<import("./ai.service").EnqueueResult>;
    getJobStatus(user: any, jobId: string): Promise<import("./ai.service").JobStatusResult>;
    dismiss(user: any, id: string): Promise<import("./entities/ai-recommendation.entity").AiRecommendation>;
    submitFeedback(user: any, id: string, dto: FeedbackDto): Promise<import("./entities/ai-recommendation.entity").AiRecommendation>;
    getAuditLogs(user: any): Promise<import("./entities/ai-audit-log.entity").AiAuditLog[]>;
}
export {};

import { Queue } from 'bullmq';
export interface DlqJob {
    id: string;
    queue: string;
    name: string;
    data: any;
    failedReason: string;
    attemptsMade: number;
    finishedOn: number;
}
export declare class DlqService {
    private readonly aiQueue;
    private readonly auditQueue;
    private readonly webhookQueue;
    constructor(aiQueue: Queue, auditQueue: Queue, webhookQueue: Queue);
    getFailedJobs(): Promise<DlqJob[]>;
    retryJob(queue: string, jobId: string): Promise<void>;
    private resolveQueue;
}

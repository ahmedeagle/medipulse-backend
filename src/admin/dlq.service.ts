import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AI_RECOMMENDATIONS_QUEUE } from '../ai/ai.constants';
import { AUDIT_QUEUE } from '../audit/audit.constants';
import { WEBHOOK_DELIVERY_QUEUE } from '../webhooks/webhook.constants';

export interface DlqJob {
  id: string;
  queue: string;
  name: string;
  data: any;
  failedReason: string;
  attemptsMade: number;
  finishedOn: number;
}

/**
 * Surfaces permanently-failed jobs (failed state, all retries exhausted) from all queues.
 * Used by the system admin to inspect and optionally retry stuck jobs.
 */
@Injectable()
export class DlqService {
  constructor(
    @InjectQueue(AI_RECOMMENDATIONS_QUEUE) private readonly aiQueue: Queue,
    @InjectQueue(AUDIT_QUEUE)              private readonly auditQueue: Queue,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)   private readonly webhookQueue: Queue,
  ) {}

  async getFailedJobs(): Promise<DlqJob[]> {
    const [aiFailed, auditFailed, webhookFailed] = await Promise.all([
      this.aiQueue.getFailed(0, 50),
      this.auditQueue.getFailed(0, 50),
      this.webhookQueue.getFailed(0, 50),
    ]);

    const toDto = (queue: string) => (job: any): DlqJob => ({
      id:           job.id,
      queue,
      name:         job.name,
      data:         job.data,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      finishedOn:   job.finishedOn,
    });

    return [
      ...aiFailed.map(toDto(AI_RECOMMENDATIONS_QUEUE)),
      ...auditFailed.map(toDto(AUDIT_QUEUE)),
      ...webhookFailed.map(toDto(WEBHOOK_DELIVERY_QUEUE)),
    ].sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0));
  }

  async retryJob(queue: string, jobId: string): Promise<void> {
    const q = this.resolveQueue(queue);
    const job = await q.getJob(jobId);
    if (job) await job.retry();
  }

  private resolveQueue(name: string): Queue {
    if (name === AI_RECOMMENDATIONS_QUEUE) return this.aiQueue;
    if (name === AUDIT_QUEUE)              return this.auditQueue;
    if (name === WEBHOOK_DELIVERY_QUEUE)   return this.webhookQueue;
    throw new Error(`Unknown queue: ${name}`);
  }
}

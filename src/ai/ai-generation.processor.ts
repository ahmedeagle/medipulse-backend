import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiService } from './ai.service';
import { AI_RECOMMENDATIONS_QUEUE } from './ai.constants';
import { AiRecommendation } from './entities/ai-recommendation.entity';

export interface GenerateJobData {
  tenantId: string;
  userId: string;
}

/**
 * Runs only in the worker process (src/worker.ts).
 *
 * concurrency:5 — up to 5 pharmacies processed in parallel per worker instance.
 * Scale worker replicas to increase throughput; each replica adds 5 concurrent slots.
 *
 * Retry is configured at enqueue time (3 attempts, exponential backoff).
 * job.attemptsMade is logged so operators can see retry depth in Bull Board.
 */
@Processor(AI_RECOMMENDATIONS_QUEUE, { concurrency: 5 })
export class AiGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(AiGenerationProcessor.name);

  constructor(private readonly aiService: AiService) {
    super();
  }

  async process(job: Job<GenerateJobData>): Promise<AiRecommendation[]> {
    const { tenantId, userId } = job.data;
    const attempt = job.attemptsMade + 1;

    this.logger.log(`[job:${job.id}] attempt ${attempt}: tenant ${tenantId}`);

    await job.updateProgress(10);  // data fetch starting
    const result = await this.aiService.runGeneration(tenantId, userId);
    await job.updateProgress(100);

    this.logger.log(`[job:${job.id}] done — ${result.length} recommendation(s)`);
    return result;
  }

  onFailed(job: Job<GenerateJobData>, err: Error): void {
    this.logger.error(
      `[job:${job.id}] failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`,
    );
  }
}

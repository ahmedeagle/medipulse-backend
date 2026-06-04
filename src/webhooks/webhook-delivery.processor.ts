import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import axios from 'axios';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WEBHOOK_DELIVERY_QUEUE } from './webhook.constants';

interface DeliverJobData {
  subscriptionId: string;
  url: string;
  payload: Record<string, any>;
  signature: string;
  eventType: string;
}

/**
 * Runs in the worker process only.
 * Delivers webhook payloads via HTTP POST with HMAC-SHA256 signature.
 * After 5 failures marks the subscription as requiresAttention.
 */
@Processor(WEBHOOK_DELIVERY_QUEUE, { concurrency: 10 })
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(WebhookSubscription)
    private subRepo: Repository<WebhookSubscription>,
  ) {
    super();
  }

  async process(job: Job<DeliverJobData>): Promise<void> {
    const { subscriptionId, url, payload, signature, eventType } = job.data;
    const body = JSON.stringify(payload);
    let statusCode: number | null = null;
    let error: string | null = null;

    try {
      const response = await axios.post(url, body, {
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          'X-MediPulse-Signature': signature,
          'X-MediPulse-Event': eventType,
          'User-Agent': 'MediPulse-Webhooks/1.0',
        },
        validateStatus: () => true, // don't throw on 4xx/5xx — we want to record the status
      });

      statusCode = response.status;

      if (response.status >= 400) {
        throw new Error(`Subscriber returned HTTP ${response.status}`);
      }
    } catch (err: any) {
      error = err.message;
      throw err; // re-throw so BullMQ retries
    } finally {
      // Record every attempt regardless of success/failure
      await this.deliveryRepo.save(
        this.deliveryRepo.create({
          subscriptionId,
          eventType,
          payload,
          statusCode,
          attemptCount: job.attemptsMade + 1,
          lastAttemptAt: new Date(),
          deliveredAt: statusCode && statusCode < 400 ? new Date() : null,
          error,
        }),
      );
    }

    this.logger.log(`[webhook] Delivered ${eventType} to ${url} — ${statusCode}`);
  }

  /** After all retries exhausted, mark subscription as requiresAttention */
  async onFailed(job: Job<DeliverJobData>, err: Error): Promise<void> {
    if (job.attemptsMade >= (job.opts.attempts ?? 5) - 1) {
      this.logger.warn(`[webhook] subscription ${job.data.subscriptionId} flagged — too many failures`);
      await this.subRepo.update(job.data.subscriptionId, { requiresAttention: true });
    }
  }
}

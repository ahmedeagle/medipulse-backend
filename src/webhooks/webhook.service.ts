import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes, createHmac } from 'crypto';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WEBHOOK_DELIVER_JOB, WEBHOOK_DELIVERY_QUEUE } from './webhook.constants';
import { EVENTS } from '../events/domain-events';

const VALID_EVENTS = new Set(Object.values(EVENTS));

@Injectable()
export class WebhookService {
  constructor(
    @InjectRepository(WebhookSubscription)
    private subRepo: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDelivery)
    private deliveryRepo: Repository<WebhookDelivery>,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly deliveryQueue: Queue,
  ) {}

  async create(tenantId: string, dto: { url: string; events: string[] }): Promise<WebhookSubscription> {
    this.validateEvents(dto.events);
    const secret = randomBytes(32).toString('hex');
    const sub = this.subRepo.create({ tenantId, url: dto.url, events: dto.events, secret });
    return this.subRepo.save(sub);
  }

  async list(tenantId: string): Promise<WebhookSubscription[]> {
    return this.subRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const sub = await this.findOwned(tenantId, id);
    await this.subRepo.remove(sub);
  }

  async listDeliveries(tenantId: string, id: string): Promise<WebhookDelivery[]> {
    await this.findOwned(tenantId, id);
    return this.deliveryRepo.find({
      where: { subscriptionId: id },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /** Dispatch a test event to verify the subscriber URL is reachable */
  async sendTestEvent(tenantId: string, id: string): Promise<{ jobId: string }> {
    const sub = await this.findOwned(tenantId, id);
    const payload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      tenantId,
      data: { message: 'MediPulse webhook test — your endpoint is configured correctly.' },
    };
    const job = await this.enqueueDelivery(sub, 'webhook.test', payload);
    return { jobId: job.id };
  }

  /** Called by WebhookDispatchListener — fans out a domain event to all matching subscriptions */
  async dispatchEvent(eventType: string, data: Record<string, any>): Promise<void> {
    const subs = await this.subRepo
      .createQueryBuilder('s')
      .where('s.isActive = true')
      .andWhere('s.requiresAttention = false')
      .andWhere(':eventType = ANY(s.events)', { eventType })
      .getMany();

    if (!subs.length) return;

    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    await Promise.all(subs.map((sub) => this.enqueueDelivery(sub, eventType, payload)));
  }

  /** Signs and enqueues a delivery job */
  async enqueueDelivery(
    sub: WebhookSubscription,
    eventType: string,
    payload: Record<string, any>,
  ) {
    const signature = this.sign(sub.secret, JSON.stringify(payload));
    return this.deliveryQueue.add(
      WEBHOOK_DELIVER_JOB,
      { subscriptionId: sub.id, url: sub.url, payload, signature, eventType },
      { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } },
    );
  }

  sign(secret: string, body: string): string {
    return 't=' + Date.now() + ',v1=' + createHmac('sha256', secret).update(body).digest('hex');
  }

  private validateEvents(events: string[]): void {
    const invalid = events.filter((e) => !VALID_EVENTS.has(e as any));
    if (invalid.length) {
      throw new BadRequestException(`Unknown event types: ${invalid.join(', ')}. Valid: ${[...VALID_EVENTS].join(', ')}`);
    }
  }

  private async findOwned(tenantId: string, id: string): Promise<WebhookSubscription> {
    const sub = await this.subRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException(`Webhook subscription ${id} not found`);
    if (sub.tenantId !== tenantId) throw new ForbiddenException('Access denied');
    return sub;
  }
}

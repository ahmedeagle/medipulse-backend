import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DomainEventLog } from './entities/domain-event-log.entity';

/**
 * Captures every domain event emitted in this process and persists it
 * to the append-only audit DB.
 *
 * Uses EventEmitter2.onAny() — a single handler catches all events regardless
 * of name, so new events are automatically stored without code changes here.
 *
 * Error isolation: a failed DB write is logged and swallowed — it must never
 * propagate back to the emitter and disrupt normal business logic.
 */
@Injectable()
export class DomainEventStoreListener implements OnModuleInit {
  private readonly logger = new Logger(DomainEventStoreListener.name);

  constructor(
    private readonly emitter: EventEmitter2,
    @InjectRepository(DomainEventLog, 'audit')
    private readonly repo: Repository<DomainEventLog>,
  ) {}

  onModuleInit(): void {
    this.emitter.onAny((eventName: string | string[], payload: any) => {
      const name = Array.isArray(eventName) ? eventName.join('.') : eventName;
      // Skip non-domain events (e.g. internal NestJS lifecycle events)
      if (!name.includes('.')) return;

      this.persist(name, payload).catch((err) =>
        this.logger.error(`DomainEventLog write failed [${name}]: ${err.message}`),
      );
    });
  }

  private async persist(eventType: string, payload: any): Promise<void> {
    const safe = JSON.parse(JSON.stringify(payload ?? {}));
    await this.repo.save(
      this.repo.create({
        eventType,
        aggregateId:   safe.orderId ?? safe.productId ?? safe.recommendationId ?? safe.catalogItemId ?? safe.transactionId ?? null,
        aggregateType: this.inferAggregateType(eventType),
        tenantId:      safe.tenantId ?? safe.pharmacyTenantId ?? safe.supplierTenantId ?? null,
        payload:       safe,
        correlationId: safe.correlationId ?? null,
      }),
    );
  }

  private inferAggregateType(eventType: string): string {
    const prefix = eventType.split('.')[0];
    const map: Record<string, string> = {
      inventory:      'inventory',
      order:          'order',
      recommendation: 'recommendation',
      supplier:       'supplier_catalog',
      stock:          'inventory',
      ai:             'ai',
      pos:            'pos',
    };
    return map[prefix] ?? prefix;
  }
}

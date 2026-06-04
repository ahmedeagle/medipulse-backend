import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { AuditEvent } from './entities/audit-event.entity';
import { AUDIT_QUEUE } from './audit.constants';

/**
 * Runs only in the worker process — never in the main HTTP app.
 * Writes audit events to the dedicated audit DB.
 * High concurrency: audit events are small, inserts are cheap.
 */
@Processor(AUDIT_QUEUE, { concurrency: 25 })
export class AuditEventProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditEventProcessor.name);

  constructor(
    @InjectRepository(AuditEvent, 'audit')
    private readonly auditRepo: Repository<AuditEvent>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const event = this.auditRepo.create(job.data);
    await this.auditRepo.save(event);
  }

  // BullMQ worker event hooks — surfaced in Bull Board UI
  onFailed(job: Job, err: Error): void {
    this.logger.error(`[audit job:${job.id}] failed: ${err.message}`);
  }
}

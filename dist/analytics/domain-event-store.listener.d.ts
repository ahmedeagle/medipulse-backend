import { OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { DomainEventLog } from './entities/domain-event-log.entity';
export declare class DomainEventStoreListener implements OnModuleInit {
    private readonly emitter;
    private readonly repo;
    private readonly logger;
    constructor(emitter: EventEmitter2, repo: Repository<DomainEventLog>);
    onModuleInit(): void;
    private persist;
    private inferAggregateType;
}

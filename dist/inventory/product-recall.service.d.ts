import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductRecall, RecallType } from './entities/product-recall.entity';
import { ProductBatch } from './entities/product-batch.entity';
import { InventoryItem } from './entities/inventory-item.entity';
export interface CreateRecallDto {
    productId: string;
    batchNumber?: string;
    recallType: RecallType;
    recallReferenceNumber: string;
    description?: string;
    effectiveAt?: Date;
    resolutionDeadline?: Date;
    createdByUserId?: string;
}
export declare class ProductRecallService {
    private readonly recallRepo;
    private readonly batchRepo;
    private readonly inventoryRepo;
    private readonly dataSource;
    private readonly eventEmitter;
    private readonly logger;
    constructor(recallRepo: Repository<ProductRecall>, batchRepo: Repository<ProductBatch>, inventoryRepo: Repository<InventoryItem>, dataSource: DataSource, eventEmitter: EventEmitter2);
    create(dto: CreateRecallDto): Promise<ProductRecall>;
    findAll(): Promise<ProductRecall[]>;
    resolve(id: string): Promise<ProductRecall>;
}

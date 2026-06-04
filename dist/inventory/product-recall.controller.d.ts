import { ProductRecallService } from './product-recall.service';
import { RecallType } from './entities/product-recall.entity';
declare class CreateRecallBodyDto {
    productId: string;
    batchNumber?: string;
    recallType: RecallType;
    recallReferenceNumber: string;
    description?: string;
    effectiveAt?: string;
    resolutionDeadline?: string;
}
export declare class ProductRecallController {
    private readonly recallSvc;
    constructor(recallSvc: ProductRecallService);
    findAll(): Promise<import("./entities/product-recall.entity").ProductRecall[]>;
    create(user: any, dto: CreateRecallBodyDto): Promise<import("./entities/product-recall.entity").ProductRecall>;
    resolve(id: string): Promise<import("./entities/product-recall.entity").ProductRecall>;
}
export {};

import { Repository } from 'typeorm';
import { InventoryItem } from './entities/inventory-item.entity';
import { ProductNormalizationService } from '../normalization/product-normalization.service';
export interface InventoryImportResult {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    errors: Array<{
        row: number;
        reason: string;
    }>;
}
export declare class InventoryImportService {
    private readonly inventoryRepo;
    private readonly normalization;
    private readonly logger;
    constructor(inventoryRepo: Repository<InventoryItem>, normalization: ProductNormalizationService);
    importCsv(pharmacyTenantId: string, fileBuffer: Buffer): Promise<InventoryImportResult>;
}

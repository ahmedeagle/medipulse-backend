import { Repository } from 'typeorm';
import { SupplierCatalogItem } from './entities/supplier-catalog-item.entity';
import { ProductNormalizationService } from '../normalization/product-normalization.service';
export interface ImportResult {
    total: number;
    imported: number;
    skipped: number;
    unmapped: number;
    errors: Array<{
        row: number;
        reason: string;
    }>;
}
export declare class CatalogImportService {
    private readonly catalogRepo;
    private readonly normalization;
    private readonly logger;
    constructor(catalogRepo: Repository<SupplierCatalogItem>, normalization: ProductNormalizationService);
    importCsv(supplierTenantId: string, fileBuffer: Buffer): Promise<ImportResult>;
}

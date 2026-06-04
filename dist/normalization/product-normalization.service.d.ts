import { Repository } from 'typeorm';
import { Product } from '../inventory/entities/product.entity';
import { ProductAlias } from './entities/product-alias.entity';
export interface NormalizedProduct {
    canonicalName: string;
    strength: string | null;
    dosageForm: string | null;
}
export declare class ProductNormalizationService {
    private readonly productRepo;
    private readonly aliasRepo;
    constructor(productRepo: Repository<Product>, aliasRepo: Repository<ProductAlias>);
    normalize(name: string, genericName?: string): NormalizedProduct;
    findOrCreateCanonical(dto: {
        name: string;
        genericName?: string;
        category: string;
        unit: string;
    }): Promise<Product>;
    mapSupplierSku(supplierTenantId: string, supplierSku: string, canonicalProductId: string, supplierName?: string): Promise<ProductAlias>;
    resolveProductId(supplierTenantId: string, supplierSku: string): Promise<string | null>;
    autoSuggestMapping(productName: string, genericName?: string): Promise<Product[]>;
    getUnmappedProducts(): Promise<Product[]>;
    getProductAliases(canonicalProductId: string): Promise<ProductAlias[]>;
}

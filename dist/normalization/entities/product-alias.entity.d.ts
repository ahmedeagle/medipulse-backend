import { Product } from '../../inventory/entities/product.entity';
export declare class ProductAlias {
    id: string;
    canonicalProductId: string;
    canonicalProduct: Product;
    supplierTenantId: string;
    supplierSku: string;
    supplierName: string;
    mappingSource: 'auto' | 'confirmed';
    mappedAt: Date;
}

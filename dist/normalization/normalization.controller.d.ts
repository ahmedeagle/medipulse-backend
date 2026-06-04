import { ProductNormalizationService } from './product-normalization.service';
declare class MapSkuDto {
    supplierTenantId: string;
    supplierSku: string;
    canonicalProductId: string;
    supplierName?: string;
}
export declare class NormalizationController {
    private readonly svc;
    constructor(svc: ProductNormalizationService);
    getUnmapped(): Promise<import("../inventory/entities/product.entity").Product[]>;
    map(dto: MapSkuDto): Promise<import("./entities/product-alias.entity").ProductAlias>;
    getAliases(id: string): Promise<import("./entities/product-alias.entity").ProductAlias[]>;
}
export {};

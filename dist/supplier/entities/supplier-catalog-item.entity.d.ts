import { Tenant } from '../../auth/entities/tenant.entity';
import { Product } from '../../inventory/entities/product.entity';
export declare class SupplierCatalogItem {
    id: string;
    supplierTenantId: string;
    supplierTenant: Tenant;
    productId: string;
    product: Product;
    price: number;
    currency: string;
    isAvailable: boolean;
    stock: number;
    deletedAt: Date;
    updatedAt: Date;
    createdAt: Date;
}

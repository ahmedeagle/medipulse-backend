import { Tenant } from '../../auth/entities/tenant.entity';
import { Product } from './product.entity';
export declare class InventoryItem {
    id: string;
    pharmacyTenantId: string;
    pharmacyTenant: Tenant;
    productId: string;
    product: Product;
    quantity: number;
    minThreshold: number;
    expiryDate: Date;
    deletedAt: Date;
    updatedAt: Date;
    createdAt: Date;
}

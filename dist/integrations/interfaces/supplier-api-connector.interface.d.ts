export interface SupplierProductAvailability {
    supplierSku: string;
    available: boolean;
    stock: number;
    price: number;
    currency: string;
    leadDays: number;
}
export interface SupplierOrderRequest {
    buyerRef: string;
    lines: Array<{
        supplierSku: string;
        quantity: number;
    }>;
    deliveryAddress?: string;
}
export interface SupplierOrderConfirmation {
    supplierOrderRef: string;
    estimatedDelivery: Date;
    confirmedLines: Array<{
        supplierSku: string;
        quantity: number;
        unitPrice: number;
    }>;
}
export interface ISupplierApiConnector {
    readonly connectorType: 'supplier_api';
    getAvailability(supplierTenantId: string, skus: string[]): Promise<SupplierProductAvailability[]>;
    placeOrder(supplierTenantId: string, order: SupplierOrderRequest): Promise<SupplierOrderConfirmation>;
    updatePricing(supplierTenantId: string): Promise<SupplierProductAvailability[]>;
    healthCheck(supplierTenantId: string): Promise<{
        connected: boolean;
        latencyMs: number;
    }>;
}

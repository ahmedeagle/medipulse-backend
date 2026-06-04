export interface ProductMaster {
    erpSku: string;
    name: string;
    genericName?: string;
    category?: string;
    unit?: string;
}
export interface ErpInventoryEntry {
    erpSku: string;
    quantity: number;
    location: string;
}
export interface ErpOrderPayload {
    erpOrderRef: string;
    supplierErpCode: string;
    lines: Array<{
        erpSku: string;
        quantity: number;
        unitPrice: number;
    }>;
}
export interface IErpConnector {
    readonly connectorType: 'erp';
    pullInventory(tenantId: string): Promise<ErpInventoryEntry[]>;
    pushOrder(tenantId: string, order: ErpOrderPayload): Promise<{
        erpRef: string;
    }>;
    getProductMaster(tenantId: string): Promise<ProductMaster[]>;
    healthCheck(tenantId: string): Promise<{
        connected: boolean;
        latencyMs: number;
    }>;
}

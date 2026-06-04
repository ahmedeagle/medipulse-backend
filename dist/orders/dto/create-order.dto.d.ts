export declare class OrderItemDto {
    productId: string;
    quantity: number;
    unitPrice: number;
}
export declare class CreateOrderDto {
    supplierTenantId: string;
    notes?: string;
    items: OrderItemDto[];
}

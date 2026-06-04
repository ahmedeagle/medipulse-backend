export declare enum ReservationStatus {
    PENDING = "pending",
    CONFIRMED = "confirmed",
    EXPIRED = "expired",
    RELEASED = "released",
    COMMITTED = "committed"
}
export declare class InventoryReservation {
    id: string;
    supplierTenantId: string;
    productId: string;
    reservedForTenantId: string;
    quantity: number;
    orderId: string | null;
    status: ReservationStatus;
    expiresAt: Date;
    createdAt: Date;
}

import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { InventoryReservation } from './entities/inventory-reservation.entity';
export declare class InventoryReservationService {
    private readonly repo;
    private readonly redis;
    constructor(repo: Repository<InventoryReservation>, redis: Redis);
    syncAvailableStock(supplierTenantId: string, productId: string, physicalStock: number): Promise<void>;
    reserve(supplierTenantId: string, productId: string, pharmacyTenantId: string, quantity: number, orderId?: string, isPending?: boolean): Promise<InventoryReservation>;
    confirm(reservationId: string, orderId: string): Promise<void>;
    commit(reservationId: string): Promise<void>;
    release(reservationId: string): Promise<void>;
    expireStale(): Promise<void>;
}

import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export enum ReservationStatus {
  PENDING   = 'pending',    // checkout hold (TTL: 15 min)
  CONFIRMED = 'confirmed',  // order placed (TTL: 24h)
  EXPIRED   = 'expired',    // TTL elapsed — stock released
  RELEASED  = 'released',   // order cancelled — stock released
  COMMITTED = 'committed',  // order shipped — reservation final
}

/**
 * Soft reservation to prevent double-selling.
 *
 * Flow:
 *  1. Pharmacy adds to order  → PENDING reservation (15 min TTL)
 *  2. Order placed            → CONFIRMED (24h TTL), decrements availableStock
 *  3. Order SHIPPED           → COMMITTED (no longer expires)
 *  4. Order CANCELLED / TTL   → RELEASED / EXPIRED, restores availableStock
 *
 * Stock availability: availableStock = physicalStock - sum(PENDING + CONFIRMED quantities)
 */
@Entity('inventory_reservations')
@Index('ix_reservation_supplier_product', ['supplierTenantId', 'productId'])
@Index('ix_reservation_status', ['status'])
@Index('ix_reservation_expires', ['expiresAt'])
export class InventoryReservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'supplier_tenant_id' })
  supplierTenantId: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'reserved_for_tenant_id' })
  reservedForTenantId: string;

  @Column()
  quantity: number;

  @Column({ name: 'order_id', nullable: true })
  orderId: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: ReservationStatus.PENDING })
  status: ReservationStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

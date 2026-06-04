import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from '../../inventory/entities/product.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { eager: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'int' })
  quantity: number;

  // ── Receipt & QC fields ────────────────────────────────────────────────────

  /**
   * Actual quantity received by the pharmacy (may differ from quantity if partial delivery).
   * null = order not yet in RECEIVED_PENDING_QC or later state.
   */
  @Column({ type: 'int', nullable: true })
  quantityReceived: number | null;

  /**
   * Quantity accepted after QC inspection.
   * Inventory is incremented by quantityAccepted, not quantity.
   * null = QC not yet performed.
   */
  @Column({ type: 'int', nullable: true })
  quantityAccepted: number | null;

  /**
   * Quantity rejected on inspection — triggers auto-RETURN_REQUESTED when > 0.
   */
  @Column({ type: 'int', nullable: true })
  quantityRejected: number | null;

  /**
   * Reason for rejection (e.g. "batch defect", "wrong product", "damaged packaging").
   */
  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  // ── Batch/lot tracking (SFDA requirement) ─────────────────────────────────

  @Column({ type: 'varchar', length: 100, nullable: true })
  batchNumber: string | null;

  @Column({ type: 'date', nullable: true })
  expiryDateOnBatch: Date | null;

  // ── Pricing ───────────────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalPrice: number;
}

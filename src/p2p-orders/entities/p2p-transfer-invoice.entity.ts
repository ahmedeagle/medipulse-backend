import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

export interface InvoiceLineItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

@Entity('p2p_transfer_invoices')
@Index(['p2pOrderId'], { unique: true })
@Index(['buyerTenantId'])
@Index(['sellerTenantId'])
export class P2pTransferInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  p2pOrderId: string;

  /** Format: P2P-YYYY-MM-NNNNNN — generated via Redis counter */
  @Column({ type: 'varchar', length: 30, unique: true })
  invoiceNumber: string;

  @Column({ type: 'uuid' })
  buyerTenantId: string;

  @Column({ type: 'uuid' })
  sellerTenantId: string;

  @Column({ type: 'jsonb', default: [] })
  items: InvoiceLineItem[];

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  issuedAt: Date;
}

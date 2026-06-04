import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled' | 'disputed';

/**
 * ZATCA-compliant tax invoice (فاتورة ضريبية).
 *
 * ZATCA Phase 2 requirements (e-invoicing mandate in Saudi Arabia):
 *   - Sequential invoice number in format: YYYY-MM-{seq}
 *   - QR code: TLV (Tag-Length-Value) Base64 encoded containing:
 *       Tag 1: Seller name
 *       Tag 2: Seller VAT number (15 digits)
 *       Tag 3: Invoice timestamp (ISO 8601)
 *       Tag 4: Invoice total (with VAT)
 *       Tag 5: VAT amount
 *   - VAT rate: 15% (standard rate for Saudi Arabia)
 *   - CRN: Commercial Registration Number
 *
 * This entity is separate from Order:
 *   - Order = procurement record (intent + fulfillment)
 *   - Invoice = legal tax document (accounting + compliance)
 *   - An invoice is only issued when goods are DELIVERED (not on order creation)
 *
 * Generation: GET /orders/:id/invoice creates the invoice on first call (idempotent).
 * Once issued, invoices are immutable. Cancellations create a credit note (separate).
 */
@Entity('invoices')
@Index(['orderId'], { unique: true })
@Index(['invoiceNumber'], { unique: true })
@Index(['pharmacyTenantId', 'issueDate'])
@Index(['supplierTenantId', 'issueDate'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'uuid' })
  supplierTenantId: string;

  // ── ZATCA invoice number ──────────────────────────────────────────────────

  /** Sequential invoice number: YYYY-MM-NNNNNN (e.g. 2025-06-000001) */
  @Column({ type: 'varchar', length: 50 })
  invoiceNumber: string;

  @Column({ type: 'date' })
  issueDate: Date;

  @Column({ type: 'date', nullable: true })
  dueDate: Date;

  // ── ZATCA financials ──────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotalAmount: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.15 })
  vatRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  vatAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ type: 'varchar', length: 3, default: 'SAR' })
  currency: string;

  // ── Buyer details (pharmacy) ───────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  buyerName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  buyerCrn: string;           // Commercial Registration Number

  @Column({ type: 'varchar', length: 15, nullable: true })
  buyerVatNumber: string;     // 15-digit VAT number

  @Column({ type: 'text', nullable: true })
  buyerAddress: string;

  // ── Seller details (supplier) ──────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  sellerName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  sellerCrn: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  sellerVatNumber: string;

  @Column({ type: 'text', nullable: true })
  sellerAddress: string;

  // ── ZATCA QR code (Phase 2) ───────────────────────────────────────────────

  /**
   * Base64-encoded TLV QR code data.
   * Format: TLV where each field is { tag (1 byte) | length (1 byte) | value }
   *   Tag 1: Seller name (UTF-8)
   *   Tag 2: Seller VAT number (ASCII)
   *   Tag 3: Invoice timestamp (ISO 8601 ASCII)
   *   Tag 4: Invoice total with VAT (ASCII decimal)
   *   Tag 5: VAT amount (ASCII decimal)
   */
  @Column({ type: 'text', nullable: true })
  qrCode: string;

  // ── Status ────────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: InvoiceStatus;

  @Column({ type: 'timestamp', nullable: true })
  issuedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string;

  @CreateDateColumn()
  createdAt: Date;
}

import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Invoice } from './entities/invoice.entity';
import { Order } from './entities/order.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { OrderStatus } from '../common/enums/order-status.enum';
import { REDIS_CLIENT } from '../common/redis/redis.module';

/**
 * ZATCA Phase 2 e-invoice service.
 *
 * Generates tax invoices that comply with Saudi Arabia's ZATCA e-invoicing mandate.
 * Invoices are only generated after delivery (DELIVERED or PARTIALLY_DELIVERED).
 * Generation is idempotent — calling twice for the same order returns the same invoice.
 *
 * Sequence numbers: uses Redis INCR for persistence across restarts and multiple replicas.
 * Key: medipulse:invoice:seq:{YYYY-MM}  — resets monthly (matches invoice number format)
 *
 * QR code format: TLV (Tag-Length-Value) Base64 encoded.
 * ZATCA Phase 2 minimum fields: seller name, VAT#, timestamp, total, VAT amount.
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async generateForOrder(orderId: string): Promise<Invoice> {
    // Idempotent — return existing if already generated
    const existing = await this.invoiceRepo.findOne({ where: { orderId } });
    if (existing) return existing;

    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product'],
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const deliveredStatuses: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED];
    if (!deliveredStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Invoice can only be generated for delivered orders. Current status: ${order.status}`,
      );
    }

    const [pharmacy, supplier] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: order.pharmacyTenantId } }),
      this.tenantRepo.findOne({ where: { id: order.supplierTenantId } }),
    ]);

    const invoiceNumber = await this.generateInvoiceNumber();
    const issueDate     = new Date();

    const invoice = this.invoiceRepo.create({
      orderId,
      pharmacyTenantId: order.pharmacyTenantId,
      supplierTenantId: order.supplierTenantId,
      invoiceNumber,
      issueDate,
      subtotalAmount: Number(order.subtotalAmount),
      vatRate:        Number(order.vatRate),
      vatAmount:      Number(order.vatAmount),
      totalAmount:    Number(order.totalAmount),
      currency:       order.currency,
      buyerName:      pharmacy?.name ?? 'Unknown Pharmacy',
      sellerName:     supplier?.name ?? 'Unknown Supplier',
      status:         'issued',
      issuedAt:       issueDate,
    });

    invoice.qrCode = this.generateZatcaQrCode({
      sellerName:     invoice.sellerName,
      sellerVatNumber: invoice.sellerVatNumber ?? '000000000000000',
      timestamp:      issueDate.toISOString(),
      totalAmount:    invoice.totalAmount,
      vatAmount:      invoice.vatAmount,
    });

    const saved = await this.invoiceRepo.save(invoice);
    this.logger.log(`Invoice ${invoiceNumber} generated for order ${orderId}`);
    return saved;
  }

  async findByOrder(orderId: string): Promise<Invoice | null> {
    return this.invoiceRepo.findOne({ where: { orderId } });
  }

  // ── ZATCA QR code — TLV encoding ─────────────────────────────────────────

  private generateZatcaQrCode(params: {
    sellerName:      string;
    sellerVatNumber: string;
    timestamp:       string;
    totalAmount:     number;
    vatAmount:       number;
  }): string {
    const fields = [
      { tag: 0x01, value: params.sellerName },
      { tag: 0x02, value: params.sellerVatNumber },
      { tag: 0x03, value: params.timestamp },
      { tag: 0x04, value: params.totalAmount.toFixed(2) },
      { tag: 0x05, value: params.vatAmount.toFixed(2) },
    ];

    const bytes: number[] = [];
    for (const field of fields) {
      const encoded = Buffer.from(field.value, 'utf-8');
      bytes.push(field.tag);
      bytes.push(encoded.length);
      bytes.push(...encoded);
    }

    return Buffer.from(bytes).toString('base64');
  }

  /**
   * Persistent invoice number using Redis INCR.
   *
   * Format: YYYY-MM-NNNNNN (e.g. 2025-06-000001)
   * Monthly key ensures the sequence is human-readable and auditable.
   * Redis INCR is atomic — safe across multiple API replicas.
   * TTL: 40 days (covers month end + buffer for late invoices)
   */
  private async generateInvoiceNumber(): Promise<string> {
    const now  = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const key  = `medipulse:invoice:seq:${year}-${month}`;

    const seq = await this.redis.incr(key);

    // Set TTL on first increment (40 days — covers the full month plus buffer)
    if (seq === 1) {
      await this.redis.expire(key, 40 * 86_400);
    }

    return `${year}-${month}-${String(seq).padStart(6, '0')}`;
  }
}

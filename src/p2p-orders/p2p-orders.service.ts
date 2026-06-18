import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { P2pOrder } from './entities/p2p-order.entity';
import { P2pTransferInvoice } from './entities/p2p-transfer-invoice.entity';
import { P2pDispute } from './entities/p2p-dispute.entity';
import { P2pListing } from '../p2p-listing/entities/p2p-listing.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { CreateP2pOrderDto, AcceptP2pOrderDto, ShipP2pOrderDto, RejectP2pOrderDto, OpenDisputeDto } from './dto/p2p-order.dto';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';
import { P2P_EVENTS } from '../events/domain-events';

export interface EnrichedP2pOrder extends P2pOrder {
  productName: string | null;
  productNameAr: string | null;
  productBarcode: string | null;
  productSku: string | null;
  productStrength: string | null;
  productDosageForm: string | null;
  listingType: 'normal' | 'clearance' | 'emergency' | null;
  offerType: 'none' | 'discount' | 'bonus' | null;
  listingExpiryDate: string | null;
  discountPct: number | null;
  bonusQty: number | null;
  sellerName: string | null;
  sellerCity: string | null;
  buyerName: string | null;
  buyerCity: string | null;
  hasInvoice: boolean;
  hasDispute: boolean;
}

@Injectable()
export class P2pOrdersService {
  private readonly logger = new Logger(P2pOrdersService.name);

  constructor(
    @InjectRepository(P2pOrder)
    private readonly orderRepo: Repository<P2pOrder>,
    @InjectRepository(P2pTransferInvoice)
    private readonly invoiceRepo: Repository<P2pTransferInvoice>,
    @InjectRepository(P2pDispute)
    private readonly disputeRepo: Repository<P2pDispute>,
    @InjectRepository(P2pListing)
    private readonly listingRepo: Repository<P2pListing>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  // ── Create order (buyer) ──────────────────────────────────────────────────

  async create(buyerTenantId: string, dto: CreateP2pOrderDto): Promise<P2pOrder> {
    const listing = await this.listingRepo.findOne({ where: { id: dto.listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'active') throw new BadRequestException('Listing is not active');
    if (listing.sellerTenantId === buyerTenantId)
      throw new BadRequestException('Cannot buy from yourself');
    if (dto.requestedQty < listing.minOrderQty)
      throw new BadRequestException(`Minimum order is ${listing.minOrderQty} units`);
    if (dto.requestedQty > listing.quantity)
      throw new BadRequestException(`Only ${listing.quantity} units available`);

    const order = await this.orderRepo.save(
      this.orderRepo.create({
        buyerTenantId,
        sellerTenantId: listing.sellerTenantId,
        listingId: dto.listingId,
        requestedQty: dto.requestedQty,
        agreedPrice: listing.price,
        notes: dto.notes,
        urgencyLevel: dto.urgencyLevel ?? 'normal',
        status: 'pending',
      }),
    );

    this.eventEmitter.emit(P2P_EVENTS.ORDER_CREATED, {
      orderId: order.id,
      sellerTenantId: order.sellerTenantId,
      buyerTenantId,
    });

    return order;
  }

  // ── Accept (seller) — SERIALIZABLE transaction ────────────────────────────

  async accept(sellerTenantId: string, orderId: string, dto: AcceptP2pOrderDto = {}): Promise<P2pOrder> {
    return this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const order = await em.findOne(P2pOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) throw new NotFoundException('Order not found');
      if (order.sellerTenantId !== sellerTenantId) throw new ForbiddenException('Not your order');
      if (order.status !== 'pending') throw new BadRequestException('Order is not pending');

      // Lock inventory to prevent over-selling
      const inventoryItem = await em
        .createQueryBuilder(InventoryItem, 'item')
        .innerJoin(P2pListing, 'listing', 'listing.inventoryItemId = item.id')
        .where('listing.id = :listingId', { listingId: order.listingId })
        .setLock('pessimistic_write')
        .getOne();

      const listing = await em.findOne(P2pListing, { where: { id: order.listingId } });

      if (!listing || listing.quantity < order.requestedQty) {
        throw new BadRequestException('Insufficient stock to fulfill this order');
      }

      // Deduct from listing quantity
      await em.update(P2pListing, listing.id, {
        quantity: listing.quantity - order.requestedQty,
        status: listing.quantity - order.requestedQty <= 0 ? 'sold_out' : 'active',
      });

      // Deduct from actual inventory
      if (inventoryItem) {
        await em.update(InventoryItem, inventoryItem.id, {
          quantity: Math.max(0, inventoryItem.quantity - order.requestedQty),
        });
      }

      // Reservation window: 60 minutes for buyer to confirm/cancel
      const reservationExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const acceptUpdate: Partial<P2pOrder> = {
        status: 'accepted',
        respondedAt: new Date(),
        reservationExpiresAt,
      };
      if (dto.expectedDeliveryAt) {
        acceptUpdate.expectedDeliveryAt = new Date(dto.expectedDeliveryAt);
      }
      await em.update(P2pOrder, orderId, acceptUpdate);

      const updated = await em.findOne(P2pOrder, { where: { id: orderId } });

      // Generate transfer invoice after commit
      setImmediate(() => this.generateInvoice(updated));

      this.eventEmitter.emit(P2P_EVENTS.ORDER_ACCEPTED, {
        orderId,
        buyerTenantId: order.buyerTenantId,
        sellerTenantId,
      });

      return updated;
    });
  }

  // ── Ship (seller) ─────────────────────────────────────────────────────────

  async ship(sellerTenantId: string, orderId: string, dto: ShipP2pOrderDto = {}): Promise<P2pOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.sellerTenantId !== sellerTenantId) throw new ForbiddenException('Not your order');
    if (order.status !== 'accepted') throw new BadRequestException('Order must be accepted before shipping');

    const setClauses = dto.note
      ? `status = 'shipped', "shippedAt" = NOW(), "deliveryNote" = $3`
      : `status = 'shipped', "shippedAt" = NOW()`;
    const qParams = dto.note ? [orderId, sellerTenantId, dto.note] : [orderId, sellerTenantId];
    const [updated] = await this.dataSource.query<P2pOrder[]>(
      `UPDATE p2p_orders SET ${setClauses} WHERE id = $1 AND "sellerTenantId" = $2 AND status = 'accepted' RETURNING *`,
      qParams,
    );
    if (!updated) throw new BadRequestException('Order could not be updated — status may have changed');

    this.eventEmitter.emit(P2P_EVENTS.ORDER_SHIPPED, {
      orderId,
      buyerTenantId: order.buyerTenantId,
      sellerTenantId,
      deliveryNote: dto.note,
    });

    return updated;
  }

  // ── Reject (seller) ───────────────────────────────────────────────────────

  async reject(sellerTenantId: string, orderId: string, dto: RejectP2pOrderDto): Promise<P2pOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.sellerTenantId !== sellerTenantId) throw new ForbiddenException('Not your order');
    if (order.status !== 'pending') throw new BadRequestException('Order is not pending');

    const [updated] = await this.dataSource.query<P2pOrder[]>(
      `UPDATE p2p_orders SET status = 'rejected', "rejectionReason" = $1, "respondedAt" = NOW()
       WHERE id = $2 AND "sellerTenantId" = $3 AND status = 'pending' RETURNING *`,
      [dto.reason, orderId, sellerTenantId],
    );
    if (!updated) throw new BadRequestException('Order could not be updated — status may have changed');

    this.eventEmitter.emit(P2P_EVENTS.ORDER_REJECTED, {
      orderId,
      buyerTenantId: order.buyerTenantId,
      sellerTenantId,
      reason: dto.reason,
    });

    return updated;
  }

  // ── Complete (buyer confirms receipt) ─────────────────────────────────────

  async complete(buyerTenantId: string, orderId: string): Promise<P2pOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerTenantId !== buyerTenantId) throw new ForbiddenException('Not your order');
    if (order.status !== 'accepted' && order.status !== 'shipped')
      throw new BadRequestException('Order must be accepted or shipped to confirm receipt');

    const [updated] = await this.dataSource.query<P2pOrder[]>(
      `UPDATE p2p_orders SET status = 'completed', "completedAt" = NOW()
       WHERE id = $1 AND "buyerTenantId" = $2 AND status IN ('accepted', 'shipped') RETURNING *`,
      [orderId, buyerTenantId],
    );
    if (!updated) throw new BadRequestException('Order could not be updated — status may have changed');

    // ── Credit purchased items to buyer's inventory ────────────────────────
    // Non-fatal: inventory update failure must never roll back a completed order.
    // Match strategy (in priority order):
    //   1. exact productId         — both items link to same catalog entry
    //   2. canonical alias chain   — one item is a non-canonical alias of the other
    //   3. barcode match           — different catalog entries but same barcode
    //   4. canonicalName match     — same INN/canonical name, different entries
    //   5. name match              — fallback text match
    //   6. new insert              — buyer has no existing item for this product
    try {
      const qty = Number(order.requestedQty);

      const [listing] = await this.dataSource.query<Array<{
        productId: string; expiryDate: string | null;
      }>>(
        `SELECT "productId", "expiryDate" FROM p2p_listings WHERE id = $1 LIMIT 1`,
        [order.listingId],
      );

      if (!listing?.productId) {
        this.logger.warn(`P2P order ${orderId}: listing ${order.listingId} not found or has no productId — inventory credit skipped`);
      } else {
        this.logger.log(`P2P order ${orderId}: crediting ${qty} units, listingProduct=${listing.productId}, buyer=${buyerTenantId}`);

        // Single-pass multi-strategy UPDATE via CTE
        const creditResult = await this.dataSource.query<Array<{
          id: string; quantity: number; quantityBefore: number; matchStrategy: string;
        }>>(
          `WITH matched AS (
             SELECT i.id,
               CASE
                 WHEN i."productId" = $3 THEN 'exact_product_id'
                 WHEN ip."canonicalProductId" = $3 THEN 'canonical_alias_to_listing'
                 WHEN (lp."canonicalProductId" IS NOT NULL AND i."productId" = lp."canonicalProductId") THEN 'listing_alias_to_canonical'
                 WHEN (ip.barcode IS NOT NULL AND ip.barcode = lp.barcode) THEN 'barcode_match'
                 WHEN (ip."canonicalName" IS NOT NULL AND lp."canonicalName" IS NOT NULL
                       AND ip."canonicalName" = lp."canonicalName") THEN 'canonical_name_match'
                 ELSE 'name_match'
               END AS match_strategy
             FROM inventory_items i
             JOIN products ip ON ip.id = i."productId"
             CROSS JOIN (
               SELECT id, barcode, "canonicalName", name, "canonicalProductId"
               FROM products WHERE id = $3
             ) lp
             WHERE i."pharmacyTenantId" = $2
               AND i."deletedAt" IS NULL
               AND (
                 i."productId" = $3
                 OR ip."canonicalProductId" = $3
                 OR (lp."canonicalProductId" IS NOT NULL AND i."productId" = lp."canonicalProductId")
                 OR (ip.barcode IS NOT NULL AND lp.barcode IS NOT NULL AND ip.barcode = lp.barcode)
                 OR (ip."canonicalName" IS NOT NULL AND lp."canonicalName" IS NOT NULL
                     AND ip."canonicalName" = lp."canonicalName")
                 OR lower(ip.name) = lower(lp.name)
               )
             ORDER BY
               CASE
                 WHEN i."productId" = $3 THEN 0
                 WHEN ip."canonicalProductId" = $3 THEN 1
                 WHEN (lp."canonicalProductId" IS NOT NULL AND i."productId" = lp."canonicalProductId") THEN 2
                 WHEN (ip.barcode IS NOT NULL AND lp.barcode IS NOT NULL AND ip.barcode = lp.barcode) THEN 3
                 WHEN (ip."canonicalName" IS NOT NULL AND lp."canonicalName" IS NOT NULL
                       AND ip."canonicalName" = lp."canonicalName") THEN 4
                 ELSE 5
               END,
               i."createdAt" DESC
             LIMIT 1
           )
           UPDATE inventory_items
           SET quantity = quantity + $1, "updatedAt" = NOW()
           FROM matched
           WHERE inventory_items.id = matched.id
           RETURNING inventory_items.id,
                     inventory_items.quantity,
                     inventory_items.quantity - $1 AS "quantityBefore",
                     matched.match_strategy AS "matchStrategy"`,
          [qty, buyerTenantId, listing.productId],
        );

        if (creditResult.length) {
          const r = creditResult[0];
          this.logger.log(
            `P2P order ${orderId}: inventory updated [${r.matchStrategy}] item=${r.id} qty: ${r.quantityBefore} → ${r.quantity}`,
          );
          await this.dataSource.query(
            `INSERT INTO inventory_movements
               ("pharmacyTenantId", "inventoryItemId", "productId", "changeType",
                "quantityBefore", "quantityDelta", "quantityAfter",
                "sourceRef", "matchStrategy", "createdAt")
             VALUES ($1, $2, $3, 'p2p_receipt', $4, $5, $6, $7, $8, NOW())`,
            [buyerTenantId, r.id, listing.productId, r.quantityBefore, qty, r.quantity,
             `p2p_order:${orderId}`, r.matchStrategy],
          );
        } else {
          // No existing item found — create a new inventory entry for this batch
          const [newItem] = await this.dataSource.query<Array<{ id: string }>>(
            `INSERT INTO inventory_items
               ("pharmacyTenantId", "productId", quantity, "minThreshold",
                "linkStatus", "costPrice", "expiryDate", location, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, 10, 'linked', $4, $5::date, 'P2P Receipt', NOW(), NOW())
             RETURNING id`,
            [buyerTenantId, listing.productId, qty, order.agreedPrice, listing.expiryDate ?? null],
          );
          this.logger.log(`P2P order ${orderId}: no existing item found — created new inventory item id=${newItem.id} qty=${qty}`);
          await this.dataSource.query(
            `INSERT INTO inventory_movements
               ("pharmacyTenantId", "inventoryItemId", "productId", "changeType",
                "quantityBefore", "quantityDelta", "quantityAfter",
                "sourceRef", "matchStrategy", "createdAt")
             VALUES ($1, $2, $3, 'p2p_receipt', 0, $4, $4, $5, 'new_insert', NOW())`,
            [buyerTenantId, newItem.id, listing.productId, qty, `p2p_order:${orderId}`],
          );
        }
      }
    } catch (err: any) {
      this.logger.error(
        `P2P order ${orderId}: inventory credit failed (non-fatal, order already completed) — ${err.message}\n${err.stack}`,
      );
    }

    this.eventEmitter.emit(P2P_EVENTS.ORDER_COMPLETED, {
      orderId,
      buyerTenantId,
      sellerTenantId: order.sellerTenantId,
    });

    return updated;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async cancel(tenantId: string, orderId: string): Promise<P2pOrder> {
    return this.dataSource.transaction('READ COMMITTED', async (em) => {
      const order = await em.findOne(P2pOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Order not found');

      const isBuyer = order.buyerTenantId === tenantId;
      const isSeller = order.sellerTenantId === tenantId;
      if (!isBuyer && !isSeller) throw new ForbiddenException('Not your order');

      // Seller can cancel: pending or accepted (NOT shipped)
      // Buyer can cancel: pending, accepted, or shipped
      const canCancel =
        order.status === 'pending' ||
        (isBuyer && (order.status === 'accepted' || order.status === 'shipped')) ||
        (isSeller && order.status === 'accepted');
      if (!canCancel)
        throw new BadRequestException(`Cannot cancel order in status '${order.status}'`);

      if (order.status === 'accepted' || order.status === 'shipped') {
        const listing = await em.findOne(P2pListing, {
          where: { id: order.listingId },
          lock: { mode: 'pessimistic_write' },
        });
        if (listing) {
          await em.update(P2pListing, listing.id, {
            quantity: listing.quantity + order.requestedQty,
            status: 'active',
          });
        }
        // Restore inventory item quantity (accept deducted it — cancel must undo that)
        const inventoryItem = await em
          .createQueryBuilder(InventoryItem, 'item')
          .innerJoin(P2pListing, 'l', 'l."inventoryItemId" = item.id')
          .where('l.id = :listingId', { listingId: order.listingId })
          .setLock('pessimistic_write')
          .getOne();
        if (inventoryItem) {
          await em.update(InventoryItem, inventoryItem.id, {
            quantity: inventoryItem.quantity + order.requestedQty,
          });
        }
      }

      await em.update(P2pOrder, orderId, { status: 'cancelled' });
      const updated = await em.findOne(P2pOrder, { where: { id: orderId } });

      this.eventEmitter.emit(P2P_EVENTS.ORDER_CANCELLED, {
        orderId,
        buyerTenantId:       order.buyerTenantId,
        sellerTenantId:      order.sellerTenantId,
        cancelledByTenantId: tenantId,
      });

      return updated;
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string | null,
    role: 'buyer' | 'seller' | 'both',
    pagination: PaginationQueryDto = {},
    status?: string,
    q?: string,
  ): Promise<PaginatedResult<EnrichedP2pOrder>> {
    if (!tenantId) return { data: [], total: 0, limit: 25, offset: 0 };
    const { limit: rawLimit, offset } = normalizePagination(pagination);
    // Hard cap: never fetch more than 50 enriched rows per page
    const limit = Math.min(rawLimit, 50);

    // ── Build WHERE params ────────────────────────────────────────────────────
    const params: any[] = [tenantId];

    const roleCondition =
      role === 'buyer'  ? `o."buyerTenantId"  = $1` :
      role === 'seller' ? `o."sellerTenantId" = $1` :
                          `(o."buyerTenantId" = $1 OR o."sellerTenantId" = $1)`;

    const extra: string[] = [];
    if (status) {
      params.push(status);
      extra.push(`o.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      const n = params.length;
      // Trigram-based ILIKE — add a pg_trgm GIN index on products.name/nameAr for sub-ms scans at scale
      extra.push(`(p.name ILIKE $${n} OR p."nameAr" ILIKE $${n} OR o.id::text LIKE $${n})`);
    }

    const whereClause = extra.length
      ? `${roleCondition} AND ${extra.join(' AND ')}`
      : roleCondition;

    // ── COUNT: avoid expensive JOINs when there is no text search ────────────
    // Without `q`, count directly from p2p_orders (hits the composite index).
    // With `q`, we must JOIN products to apply the text filter.
    const countParams = [...params];
    const fastCount = !q;
    const countQuery = fastCount
      ? `SELECT COUNT(*)::text AS total FROM p2p_orders o WHERE ${whereClause}`
      : `SELECT COUNT(*)::text AS total
         FROM p2p_orders o
         LEFT JOIN p2p_listings l ON l.id = o."listingId"
         LEFT JOIN products p      ON p.id = l."productId"
         WHERE ${whereClause}`;

    // ── Main query ────────────────────────────────────────────────────────────
    const [countRows, rows] = await Promise.all([
      this.dataSource.query<Array<{ total: string }>>(countQuery, countParams),
      this.dataSource.query<any[]>(`
        SELECT
          o.id, o."buyerTenantId", o."sellerTenantId", o."listingId",
          o."requestedQty", o."agreedPrice", o.status,
          o."urgencyLevel", o."expectedDeliveryAt", o."shippedAt", o."deliveryNote",
          o."reservationExpiresAt", o.notes, o."rejectionReason",
          o."respondedAt", o."completedAt", o."updatedAt", o."createdAt",
          p.name                                   AS "productName",
          p."nameAr"                               AS "productNameAr",
          p.barcode                                AS "productBarcode",
          p.sku                                    AS "productSku",
          p.strength                               AS "productStrength",
          p."dosageForm"                           AS "productDosageForm",
          l."listingType"                          AS "listingType",
          l."offerType"                            AS "offerType",
          l."expiryDate"                           AS "listingExpiryDate",
          l."discountPct"                          AS "discountPct",
          l."bonusQty"                             AS "bonusQty",
          COALESCE(sp_s."legalName", t_s.name)    AS "sellerName",
          COALESCE(sp_s.city, t_s.city)           AS "sellerCity",
          COALESCE(sp_b."legalName", t_b.name)    AS "buyerName",
          COALESCE(sp_b.city, t_b.city)           AS "buyerCity",
          (ti."p2pOrderId" IS NOT NULL)            AS "hasInvoice",
          (dp."p2pOrderId" IS NOT NULL)            AS "hasDispute"
        FROM p2p_orders o
        LEFT JOIN p2p_listings l       ON l.id  = o."listingId"
        LEFT JOIN products p            ON p.id  = l."productId"
        LEFT JOIN seller_profiles sp_s  ON sp_s."pharmacyTenantId" = o."sellerTenantId"
        LEFT JOIN seller_profiles sp_b  ON sp_b."pharmacyTenantId" = o."buyerTenantId"
        LEFT JOIN tenants t_s           ON t_s.id = o."sellerTenantId"
        LEFT JOIN tenants t_b           ON t_b.id = o."buyerTenantId"
        LEFT JOIN LATERAL (
          SELECT "p2pOrderId" FROM p2p_transfer_invoices WHERE "p2pOrderId" = o.id LIMIT 1
        ) ti ON true
        LEFT JOIN LATERAL (
          SELECT "p2pOrderId" FROM p2p_disputes WHERE "p2pOrderId" = o.id LIMIT 1
        ) dp ON true
        WHERE ${whereClause}
        ORDER BY o."createdAt" DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limit, offset]),
    ]);

    return {
      data: rows as EnrichedP2pOrder[],
      total: parseInt(countRows[0]?.total ?? '0', 10),
      limit,
      offset,
    };
  }

  async findOne(tenantId: string, orderId: string): Promise<P2pOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerTenantId !== tenantId && order.sellerTenantId !== tenantId)
      throw new ForbiddenException('Not your order');
    return order;
  }

  async getInvoice(tenantId: string, orderId: string): Promise<P2pTransferInvoice> {
    await this.findOne(tenantId, orderId);
    const invoice = await this.invoiceRepo.findOne({ where: { p2pOrderId: orderId } });
    if (!invoice) throw new NotFoundException('Invoice not yet generated');
    return invoice;
  }

  // ── Dispute ───────────────────────────────────────────────────────────────

  async openDispute(
    buyerTenantId: string,
    orderId: string,
    dto: OpenDisputeDto,
  ): Promise<P2pDispute> {
    const order = await this.findOne(buyerTenantId, orderId);
    if (order.buyerTenantId !== buyerTenantId)
      throw new ForbiddenException('Only the buyer can open a dispute');
    if (!['shipped', 'completed'].includes(order.status))
      throw new BadRequestException('Can only open a dispute on a shipped or completed order');

    const existing = await this.disputeRepo.findOne({ where: { p2pOrderId: orderId } });
    if (existing) throw new BadRequestException('A dispute already exists for this order');

    return this.disputeRepo.save(
      this.disputeRepo.create({
        p2pOrderId: orderId,
        raisedByTenantId: buyerTenantId,
        type: dto.type as any,
        description: dto.description,
        evidenceUrls: dto.evidenceUrls ?? [],
      }),
    );
  }

  async getDispute(tenantId: string, orderId: string): Promise<P2pDispute | null> {
    await this.findOne(tenantId, orderId);
    return this.disputeRepo.findOne({ where: { p2pOrderId: orderId } });
  }

  // ── Invoice generation (async, called after accept commits) ───────────────

  private async generateInvoice(order: P2pOrder): Promise<void> {
    try {
      const [listingRows, invoiceNumber] = await Promise.all([
        this.dataSource.query<Array<{ productId: string; nameAr: string | null; name: string | null }>>(
          `SELECT l."productId", p."nameAr", p.name
           FROM p2p_listings l LEFT JOIN products p ON p.id = l."productId"
           WHERE l.id = $1 LIMIT 1`,
          [order.listingId],
        ),
        this.nextInvoiceNumber(),
      ]);
      const row = listingRows[0];
      const productName = row?.nameAr ?? row?.name ?? `Order ${order.id.slice(0, 8)}`;

      const lineTotal = Number(order.agreedPrice) * order.requestedQty;

      await this.invoiceRepo.save(
        this.invoiceRepo.create({
          p2pOrderId: order.id,
          invoiceNumber,
          buyerTenantId: order.buyerTenantId,
          sellerTenantId: order.sellerTenantId,
          items: [
            {
              productId: row?.productId ?? '',
              productName,
              quantity: order.requestedQty,
              unitPrice: Number(order.agreedPrice),
              lineTotal,
            },
          ],
          subtotal: lineTotal,
          totalAmount: lineTotal,
        }),
      );

      this.eventEmitter.emit(P2P_EVENTS.INVOICE_GENERATED, {
        orderId: order.id,
        invoiceNumber,
        buyerTenantId: order.buyerTenantId,
      });
    } catch (err: any) {
      this.logger.error(`Failed to generate invoice for order ${order.id}: ${err.message}`);
    }
  }

  private async nextInvoiceNumber(): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const key = `medipulse:p2p:invoice:seq:${yearMonth}`;
    const seq = await this.redis.incr(key);
    await this.redis.expire(key, 90 * 86400); // auto-expire after 90 days
    return `P2P-${yearMonth}-${String(seq).padStart(6, '0')}`;
  }
}

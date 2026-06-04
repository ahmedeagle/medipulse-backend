import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Order, OrderHistoryEntry } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderReturnRequest, ReturnItem } from './entities/order-return-request.entity';
import { OrderComment } from './entities/order-comment.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus } from '../common/enums/order-status.enum';
import { Role } from '../common/enums/role.enum';
import {
  OrderStatusChangedEvent,
  OrderDeliveredEvent,
  EVENTS,
} from '../events/domain-events';

// ── Complete enterprise state machine ─────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.DRAFT]:              [OrderStatus.SUBMITTED, OrderStatus.CANCELLED],
  [OrderStatus.PENDING_APPROVAL]:   [OrderStatus.SUBMITTED, OrderStatus.CANCELLED],
  [OrderStatus.SUBMITTED]:          [OrderStatus.ACCEPTED, OrderStatus.BACK_ORDERED, OrderStatus.COUNTER_OFFER, OrderStatus.CANCELLED],
  [OrderStatus.COUNTER_OFFER]:      [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]:           [OrderStatus.SHIPPED, OrderStatus.BACK_ORDERED, OrderStatus.ON_HOLD, OrderStatus.CANCELLED],
  [OrderStatus.BACK_ORDERED]:       [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]:            [OrderStatus.RECEIVED_PENDING_QC, OrderStatus.FAILED_DELIVERY],
  [OrderStatus.FAILED_DELIVERY]:    [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.ON_HOLD]:            [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.RECEIVED_PENDING_QC]:[OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED, OrderStatus.DISPUTED],
  [OrderStatus.DELIVERED]:          [OrderStatus.DISPUTED, OrderStatus.RETURN_REQUESTED],
  [OrderStatus.PARTIALLY_DELIVERED]:[OrderStatus.DELIVERED, OrderStatus.DISPUTED, OrderStatus.RETURN_REQUESTED],
  [OrderStatus.DISPUTED]:           [OrderStatus.DELIVERED, OrderStatus.RETURN_REQUESTED, OrderStatus.CANCELLED],
  [OrderStatus.RETURN_REQUESTED]:   [OrderStatus.RETURN_APPROVED, OrderStatus.DISPUTED],
  [OrderStatus.RETURN_APPROVED]:    [OrderStatus.RETURN_IN_TRANSIT],
  [OrderStatus.RETURN_IN_TRANSIT]:  [OrderStatus.RETURN_RECEIVED],
  [OrderStatus.RETURN_RECEIVED]:    [OrderStatus.CREDIT_ISSUED],
  [OrderStatus.CREDIT_ISSUED]:      [],  // terminal
  [OrderStatus.CANCELLED]:          [],  // terminal
};

// Statuses that trigger inventory update (accepted goods only)
const DELIVERY_STATUSES = new Set([OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED]);

// Statuses where supplier is the actor
const SUPPLIER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.SUBMITTED]:   [OrderStatus.ACCEPTED, OrderStatus.BACK_ORDERED, OrderStatus.COUNTER_OFFER, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]:    [OrderStatus.SHIPPED, OrderStatus.BACK_ORDERED, OrderStatus.ON_HOLD],
  [OrderStatus.BACK_ORDERED]:[OrderStatus.SHIPPED],
  [OrderStatus.RETURN_APPROVED]:[OrderStatus.RETURN_IN_TRANSIT],
  [OrderStatus.RETURN_IN_TRANSIT]:[OrderStatus.RETURN_RECEIVED],
  [OrderStatus.RETURN_RECEIVED]:[OrderStatus.CREDIT_ISSUED],
};

// Statuses where pharmacy is the actor
const PHARMACY_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.DRAFT]:            [OrderStatus.SUBMITTED, OrderStatus.CANCELLED],
  [OrderStatus.PENDING_APPROVAL]: [OrderStatus.SUBMITTED, OrderStatus.CANCELLED],
  [OrderStatus.COUNTER_OFFER]:    [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]:          [OrderStatus.RECEIVED_PENDING_QC, OrderStatus.FAILED_DELIVERY],
  [OrderStatus.FAILED_DELIVERY]:  [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.ON_HOLD]:          [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.RECEIVED_PENDING_QC]:[OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED, OrderStatus.DISPUTED],
  [OrderStatus.DELIVERED]:        [OrderStatus.DISPUTED, OrderStatus.RETURN_REQUESTED],
  [OrderStatus.PARTIALLY_DELIVERED]:[OrderStatus.DELIVERED, OrderStatus.DISPUTED, OrderStatus.RETURN_REQUESTED],
  [OrderStatus.DISPUTED]:         [OrderStatus.RETURN_REQUESTED],
};

const SAR_VAT_RATE = 0.15;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private orderItemRepo: Repository<OrderItem>,
    @InjectRepository(OrderReturnRequest)
    private returnRepo: Repository<OrderReturnRequest>,
    @InjectRepository(OrderComment)
    private commentRepo: Repository<OrderComment>,
    @InjectRepository(InventoryItem)
    private inventoryItemRepo: Repository<InventoryItem>,
    @InjectRepository(SupplierCatalogItem)
    private catalogRepo: Repository<SupplierCatalogItem>,
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Read ─────────────────────────────────────────────────────────────────

  async findAll(
    user: { role: string; tenantId: string },
    filters: { status?: string; supplierTenantId?: string; from?: Date; to?: Date; take?: number; skip?: number } = {},
  ): Promise<{ data: Order[]; total: number }> {
    const qb = this.orderRepo
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .leftJoinAndSelect('order.pharmacyTenant', 'pharmacyTenant')
      .leftJoinAndSelect('order.supplierTenant', 'supplierTenant');

    if (user.role === Role.PHARMACY_ADMIN) {
      qb.where('order.pharmacyTenantId = :tenantId', { tenantId: user.tenantId });
    } else if (user.role === Role.SUPPLIER_ADMIN) {
      qb.where('order.supplierTenantId = :tenantId', { tenantId: user.tenantId });
    }

    if (filters.status)           qb.andWhere('order.status = :status', { status: filters.status });
    if (filters.supplierTenantId) qb.andWhere('order.supplierTenantId = :sid', { sid: filters.supplierTenantId });
    if (filters.from)             qb.andWhere('order.createdAt >= :from', { from: filters.from });
    if (filters.to)               qb.andWhere('order.createdAt <= :to', { to: filters.to });

    const [data, total] = await qb
      .orderBy('order.createdAt', 'DESC')
      .take(Math.min(filters.take ?? 50, 200))
      .skip(filters.skip ?? 0)
      .getManyAndCount();

    return { data, total };
  }

  async findOne(user: { role: string; tenantId: string }, id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    this.assertAccess(user, order);
    return order;
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(pharmacyTenantId: string, dto: CreateOrderDto, user: { id: string; role: string }): Promise<Order> {
    if (!dto.items?.length) throw new BadRequestException('Order must have at least one item');

    // Validate controlled substance and drug interaction acknowledgements
    for (const item of dto.items) {
      const catalogEntry = await this.catalogRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.product', 'product')
        .where('c.supplierTenantId = :supplierTenantId', { supplierTenantId: dto.supplierTenantId })
        .andWhere('c.productId = :productId', { productId: item.productId })
        .getOne();

      const product = catalogEntry?.product;
      if (product?.controlledSubstanceSchedule != null && !(dto as any).pharmacistAcknowledged) {
        throw new BadRequestException(
          `Product "${product.name}" is a Saudi MOH Schedule ${product.controlledSubstanceSchedule} controlled substance. ` +
          `A licensed pharmacist must verify this order. Pass pharmacistAcknowledged: true to confirm.`,
        );
      }
      if (product?.hasDrugInteractionRisk && !(dto as any).interactionRiskAcknowledged) {
        throw new BadRequestException(
          `Product "${product.name}" has known drug interaction risks. ` +
          `${product.drugInteractionNotes ?? ''} ` +
          `Review patient medication list and pass interactionRiskAcknowledged: true to confirm.`,
        );
      }
    }

    // Duplicate order guard
    for (const item of dto.items) {
      const duplicate = await this.orderRepo
        .createQueryBuilder('o')
        .innerJoin('o.items', 'oi')
        .where('o.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
        .andWhere('o.supplierTenantId = :supplierTenantId', { supplierTenantId: dto.supplierTenantId })
        .andWhere('oi.productId = :productId', { productId: item.productId })
        .andWhere('o.status NOT IN (:...terminals)', { terminals: ['delivered', 'cancelled', 'credit_issued'] })
        .getOne();

      if (duplicate && !dto['allowDuplicate']) {
        throw new BadRequestException(
          `An open order for product ${item.productId} with this supplier already exists (${duplicate.id}). ` +
          `Pass allowDuplicate: true to override.`,
        );
      }

      const listing = await this.catalogRepo.findOne({
        where: { supplierTenantId: dto.supplierTenantId, productId: item.productId, isAvailable: true },
      });
      if (!listing) {
        throw new BadRequestException(`Supplier does not carry product ${item.productId} or it is unavailable`);
      }
    }

    const subtotalAmount = dto.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
    const vatAmount      = Math.round(subtotalAmount * SAR_VAT_RATE * 100) / 100;
    const totalAmount    = Math.round((subtotalAmount + vatAmount) * 100) / 100;

    // Check approval threshold
    const tenant = await this.tenantRepo.findOne({ where: { id: pharmacyTenantId } });
    const threshold = (tenant as any)?.orderApprovalThresholdSar;
    const needsApproval = threshold && totalAmount > Number(threshold);
    const initialStatus = needsApproval ? OrderStatus.PENDING_APPROVAL : OrderStatus.SUBMITTED;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction('READ COMMITTED');

    try {
      const historyEntry: OrderHistoryEntry = {
        from: 'created', to: initialStatus, changedBy: user.id, changedByRole: user.role,
        at: new Date().toISOString(), reason: needsApproval ? 'Approval required above threshold' : undefined,
      };

      const order = qr.manager.create(Order, {
        pharmacyTenantId,
        supplierTenantId:  dto.supplierTenantId,
        notes:             dto.notes,
        currency:          'SAR',
        subtotalAmount,
        vatRate:           SAR_VAT_RATE,
        vatAmount,
        totalAmount,
        status:            initialStatus,
        changeHistory:     [historyEntry],
      });
      const savedOrder = await qr.manager.save(Order, order);

      await qr.manager.save(OrderItem, dto.items.map((i) =>
        qr.manager.create(OrderItem, {
          orderId:    savedOrder.id,
          productId:  i.productId,
          quantity:   i.quantity,
          unitPrice:  i.unitPrice,
          totalPrice: Number(i.quantity) * Number(i.unitPrice),
        }),
      ));

      await qr.commitTransaction();

      if (needsApproval) {
        this.eventEmitter.emit('order.approval_required', { orderId: savedOrder.id, pharmacyTenantId, totalAmount });
      } else {
        this.eventEmitter.emit('order.submitted', { orderId: savedOrder.id, pharmacyTenantId, supplierTenantId: dto.supplierTenantId });
      }

      return this.orderRepo.findOne({
        where: { id: savedOrder.id },
        relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'],
      });
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  // ─── Status transitions ───────────────────────────────────────────────────

  async updateStatus(
    user: { id: string; role: string; tenantId: string },
    id: string,
    newStatus: OrderStatus,
    opts: { reason?: string; counterOfferNotes?: string } = {},
  ): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    // Access control: supplier owns supplier transitions, pharmacy owns pharmacy transitions
    if (user.role === Role.SUPPLIER_ADMIN && order.supplierTenantId !== user.tenantId) throw new ForbiddenException();
    if (user.role === Role.PHARMACY_ADMIN && order.pharmacyTenantId !== user.tenantId) throw new ForbiddenException();

    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition order from "${order.status}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    const historyEntry: OrderHistoryEntry = {
      from: order.status, to: newStatus, changedBy: user.id,
      changedByRole: user.role, at: new Date().toISOString(), reason: opts.reason,
    };

    const updatePayload: Partial<Order> = {
      status: newStatus,
      changeHistory: [...(order.changeHistory ?? []), historyEntry],
    };

    // Status-specific field updates
    if (newStatus === OrderStatus.CANCELLED)    updatePayload.cancellationReason   = opts.reason ?? null;
    if (newStatus === OrderStatus.COUNTER_OFFER) updatePayload.counterOfferNotes   = opts.counterOfferNotes ?? null;
    if (newStatus === OrderStatus.DISPUTED)     { updatePayload.disputeReason = opts.reason; updatePayload.disputeOpenedAt = new Date(); }
    if (newStatus === OrderStatus.ON_HOLD)      updatePayload.onHoldReason         = opts.reason ?? null;
    if ([OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED, OrderStatus.CREDIT_ISSUED].includes(newStatus)) {
      updatePayload.disputeResolvedAt = new Date();
    }

    const previousStatus = order.status;
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction('SERIALIZABLE');

    try {
      await qr.manager.update(Order, id, updatePayload);

      // Inventory update on delivery — uses quantityAccepted (not quantity)
      if (DELIVERY_STATUSES.has(newStatus)) {
        for (const item of order.items) {
          const accepted = item.quantityAccepted != null
            ? Number(item.quantityAccepted)
            : Number(item.quantity);

          if (accepted <= 0) continue;

          const existing = await qr.manager.findOne(InventoryItem, {
            where: { pharmacyTenantId: order.pharmacyTenantId, productId: item.productId, deletedAt: null },
            lock: { mode: 'pessimistic_write' },
          });

          if (existing) {
            await qr.manager.update(InventoryItem, existing.id, { quantity: Number(existing.quantity) + accepted });
          } else {
            await qr.manager.save(InventoryItem, qr.manager.create(InventoryItem, {
              pharmacyTenantId: order.pharmacyTenantId, productId: item.productId, quantity: accepted, minThreshold: 10,
            }));
          }
        }
        this.logger.log(`Inventory updated for ${order.pharmacyTenantId} — order ${id} → ${newStatus}`);
      }

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // Emit events outside transaction
    this.eventEmitter.emit(EVENTS.ORDER_STATUS_CHANGED, new OrderStatusChangedEvent(id, order.pharmacyTenantId, order.supplierTenantId, previousStatus, newStatus));
    // Emit for both DELIVERED and PARTIALLY_DELIVERED — both update inventory and close the recommendation loop
    if (newStatus === OrderStatus.DELIVERED || newStatus === OrderStatus.PARTIALLY_DELIVERED) {
      this.eventEmitter.emit(EVENTS.ORDER_DELIVERED, new OrderDeliveredEvent(id, order.pharmacyTenantId, order.supplierTenantId,
        order.items
          .filter((i) => (i.quantityAccepted ?? i.quantity) > 0)
          .map((i) => ({ productId: i.productId, quantity: i.quantityAccepted ?? i.quantity, unitPrice: Number(i.unitPrice) })),
      ));
    }
    if (newStatus === OrderStatus.RETURN_REQUESTED) this.eventEmitter.emit('order.return_requested', { orderId: id, pharmacyTenantId: order.pharmacyTenantId });
    if (newStatus === OrderStatus.DISPUTED)         this.eventEmitter.emit('order.disputed',         { orderId: id, reason: opts.reason });

    return this.orderRepo.findOne({ where: { id }, relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'] });
  }

  // ─── Approve (director sign-off for large orders) ─────────────────────────

  async approve(user: { id: string; role: string; tenantId: string }, id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    if (order.pharmacyTenantId !== user.tenantId) throw new ForbiddenException();
    if (order.status !== OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Order is not pending approval');
    }

    const historyEntry: OrderHistoryEntry = {
      from: OrderStatus.PENDING_APPROVAL, to: OrderStatus.SUBMITTED,
      changedBy: user.id, changedByRole: user.role, at: new Date().toISOString(),
      reason: 'Director approved',
    };

    await this.orderRepo.update(id, {
      status:            OrderStatus.SUBMITTED,
      approvedByUserId:  user.id,
      approvedAt:        new Date(),
      changeHistory:     [...(order.changeHistory ?? []), historyEntry],
    });

    this.eventEmitter.emit('order.submitted', { orderId: id, pharmacyTenantId: order.pharmacyTenantId, supplierTenantId: order.supplierTenantId });
    return this.orderRepo.findOne({ where: { id }, relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'] });
  }

  // ─── Receive (pharmacy confirms receipt with QC data) ─────────────────────

  async confirmReceipt(
    user: { id: string; role: string; tenantId: string },
    id: string,
    items: Array<{ orderItemId: string; quantityAccepted: number; quantityRejected?: number; rejectionReason?: string; batchNumber?: string; expiryDateOnBatch?: string }>,
    opts: { deliveryProofUrl?: string; recipientName?: string } = {},
  ): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['items'] });
    if (!order) throw new NotFoundException();
    if (order.pharmacyTenantId !== user.tenantId) throw new ForbiddenException();
    if (order.status !== OrderStatus.RECEIVED_PENDING_QC) {
      throw new BadRequestException('Order must be in RECEIVED_PENDING_QC status to confirm receipt');
    }

    // Validate quantities
    for (const item of items) {
      const orderItem = order.items.find((i) => i.id === item.orderItemId);
      if (!orderItem) throw new BadRequestException(`OrderItem ${item.orderItemId} not found on this order`);
      if (item.quantityAccepted < 0) throw new BadRequestException('quantityAccepted cannot be negative');
      if ((item.quantityRejected ?? 0) < 0) throw new BadRequestException('quantityRejected cannot be negative');
      const totalReceived = item.quantityAccepted + (item.quantityRejected ?? 0);
      if (totalReceived > Number(orderItem.quantity)) {
        throw new BadRequestException(`Total received (${totalReceived}) exceeds ordered quantity (${orderItem.quantity}) for item ${item.orderItemId}`);
      }
    }

    // Update each item
    for (const item of items) {
      await this.orderItemRepo.update(item.orderItemId, {
        quantityAccepted:   item.quantityAccepted,
        quantityRejected:   item.quantityRejected ?? 0,
        quantityReceived:   item.quantityAccepted + (item.quantityRejected ?? 0),
        rejectionReason:    item.rejectionReason ?? null,
        batchNumber:        item.batchNumber ?? null,
        expiryDateOnBatch:  item.expiryDateOnBatch ? new Date(item.expiryDateOnBatch) : null,
      });
    }

    const totalAccepted = items.reduce((s, i) => s + i.quantityAccepted, 0);
    const totalRejected = items.reduce((s, i) => s + (i.quantityRejected ?? 0), 0);
    const newStatus = totalAccepted === 0
      ? OrderStatus.DISPUTED
      : totalRejected > 0 ? OrderStatus.PARTIALLY_DELIVERED : OrderStatus.DELIVERED;

    // Update delivery proof fields
    if (opts.deliveryProofUrl || opts.recipientName) {
      await this.orderRepo.update(id, {
        deliveryProofUrl: opts.deliveryProofUrl,
        deliveryTimestamp: new Date(),
        recipientName: opts.recipientName,
      });
    }

    return this.updateStatus(user, id, newStatus, { reason: `Received: ${totalAccepted} accepted, ${totalRejected} rejected` });
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async addComment(
    user: { id: string; role: string; tenantId: string },
    orderId: string,
    body: string,
    authorName?: string,
  ): Promise<OrderComment> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    this.assertAccess(user, order);

    const comment = this.commentRepo.create({
      orderId, authorId: user.id, authorRole: user.role as any,
      authorName: authorName ?? null, body, isSystemMessage: false,
    });
    return this.commentRepo.save(comment);
  }

  async getComments(user: { role: string; tenantId: string }, orderId: string): Promise<OrderComment[]> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    this.assertAccess(user, order);
    return this.commentRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  // ─── Return request ───────────────────────────────────────────────────────

  async initiateReturn(
    user: { id: string; role: string; tenantId: string },
    orderId: string,
    items: ReturnItem[],
  ): Promise<OrderReturnRequest> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    if (order.pharmacyTenantId !== user.tenantId) throw new ForbiddenException();

    const returnReq = this.returnRepo.create({
      orderId,
      pharmacyTenantId: order.pharmacyTenantId,
      supplierTenantId: order.supplierTenantId,
      requestedByUserId: user.id,
      items,
    });
    const saved = await this.returnRepo.save(returnReq);

    await this.updateStatus(user, orderId, OrderStatus.RETURN_REQUESTED, { reason: `Return requested for ${items.length} item(s)` });
    return saved;
  }

  async getReturnRequests(orderId: string): Promise<OrderReturnRequest[]> {
    return this.returnRepo.find({ where: { orderId }, order: { createdAt: 'DESC' } });
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private assertAccess(user: { role: string; tenantId: string }, order: Order): void {
    if (user.role === Role.PHARMACY_ADMIN && order.pharmacyTenantId !== user.tenantId) throw new ForbiddenException('Access denied');
    if (user.role === Role.SUPPLIER_ADMIN && order.supplierTenantId !== user.tenantId) throw new ForbiddenException('Access denied');
  }
}

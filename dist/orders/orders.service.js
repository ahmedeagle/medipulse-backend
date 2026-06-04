"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var OrdersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const order_entity_1 = require("./entities/order.entity");
const order_item_entity_1 = require("./entities/order-item.entity");
const order_return_request_entity_1 = require("./entities/order-return-request.entity");
const order_comment_entity_1 = require("./entities/order-comment.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const order_status_enum_1 = require("../common/enums/order-status.enum");
const role_enum_1 = require("../common/enums/role.enum");
const domain_events_1 = require("../events/domain-events");
const ALLOWED_TRANSITIONS = {
    [order_status_enum_1.OrderStatus.DRAFT]: [order_status_enum_1.OrderStatus.SUBMITTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.PENDING_APPROVAL]: [order_status_enum_1.OrderStatus.SUBMITTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.SUBMITTED]: [order_status_enum_1.OrderStatus.ACCEPTED, order_status_enum_1.OrderStatus.BACK_ORDERED, order_status_enum_1.OrderStatus.COUNTER_OFFER, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.COUNTER_OFFER]: [order_status_enum_1.OrderStatus.ACCEPTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.ACCEPTED]: [order_status_enum_1.OrderStatus.SHIPPED, order_status_enum_1.OrderStatus.BACK_ORDERED, order_status_enum_1.OrderStatus.ON_HOLD, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.BACK_ORDERED]: [order_status_enum_1.OrderStatus.SHIPPED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.SHIPPED]: [order_status_enum_1.OrderStatus.RECEIVED_PENDING_QC, order_status_enum_1.OrderStatus.FAILED_DELIVERY],
    [order_status_enum_1.OrderStatus.FAILED_DELIVERY]: [order_status_enum_1.OrderStatus.SHIPPED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.ON_HOLD]: [order_status_enum_1.OrderStatus.ACCEPTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.RECEIVED_PENDING_QC]: [order_status_enum_1.OrderStatus.DELIVERED, order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED, order_status_enum_1.OrderStatus.DISPUTED],
    [order_status_enum_1.OrderStatus.DELIVERED]: [order_status_enum_1.OrderStatus.DISPUTED, order_status_enum_1.OrderStatus.RETURN_REQUESTED],
    [order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED]: [order_status_enum_1.OrderStatus.DELIVERED, order_status_enum_1.OrderStatus.DISPUTED, order_status_enum_1.OrderStatus.RETURN_REQUESTED],
    [order_status_enum_1.OrderStatus.DISPUTED]: [order_status_enum_1.OrderStatus.DELIVERED, order_status_enum_1.OrderStatus.RETURN_REQUESTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.RETURN_REQUESTED]: [order_status_enum_1.OrderStatus.RETURN_APPROVED, order_status_enum_1.OrderStatus.DISPUTED],
    [order_status_enum_1.OrderStatus.RETURN_APPROVED]: [order_status_enum_1.OrderStatus.RETURN_IN_TRANSIT],
    [order_status_enum_1.OrderStatus.RETURN_IN_TRANSIT]: [order_status_enum_1.OrderStatus.RETURN_RECEIVED],
    [order_status_enum_1.OrderStatus.RETURN_RECEIVED]: [order_status_enum_1.OrderStatus.CREDIT_ISSUED],
    [order_status_enum_1.OrderStatus.CREDIT_ISSUED]: [],
    [order_status_enum_1.OrderStatus.CANCELLED]: [],
};
const DELIVERY_STATUSES = new Set([order_status_enum_1.OrderStatus.DELIVERED, order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED]);
const SUPPLIER_TRANSITIONS = {
    [order_status_enum_1.OrderStatus.SUBMITTED]: [order_status_enum_1.OrderStatus.ACCEPTED, order_status_enum_1.OrderStatus.BACK_ORDERED, order_status_enum_1.OrderStatus.COUNTER_OFFER, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.ACCEPTED]: [order_status_enum_1.OrderStatus.SHIPPED, order_status_enum_1.OrderStatus.BACK_ORDERED, order_status_enum_1.OrderStatus.ON_HOLD],
    [order_status_enum_1.OrderStatus.BACK_ORDERED]: [order_status_enum_1.OrderStatus.SHIPPED],
    [order_status_enum_1.OrderStatus.RETURN_APPROVED]: [order_status_enum_1.OrderStatus.RETURN_IN_TRANSIT],
    [order_status_enum_1.OrderStatus.RETURN_IN_TRANSIT]: [order_status_enum_1.OrderStatus.RETURN_RECEIVED],
    [order_status_enum_1.OrderStatus.RETURN_RECEIVED]: [order_status_enum_1.OrderStatus.CREDIT_ISSUED],
};
const PHARMACY_TRANSITIONS = {
    [order_status_enum_1.OrderStatus.DRAFT]: [order_status_enum_1.OrderStatus.SUBMITTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.PENDING_APPROVAL]: [order_status_enum_1.OrderStatus.SUBMITTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.COUNTER_OFFER]: [order_status_enum_1.OrderStatus.ACCEPTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.SHIPPED]: [order_status_enum_1.OrderStatus.RECEIVED_PENDING_QC, order_status_enum_1.OrderStatus.FAILED_DELIVERY],
    [order_status_enum_1.OrderStatus.FAILED_DELIVERY]: [order_status_enum_1.OrderStatus.SHIPPED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.ON_HOLD]: [order_status_enum_1.OrderStatus.ACCEPTED, order_status_enum_1.OrderStatus.CANCELLED],
    [order_status_enum_1.OrderStatus.RECEIVED_PENDING_QC]: [order_status_enum_1.OrderStatus.DELIVERED, order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED, order_status_enum_1.OrderStatus.DISPUTED],
    [order_status_enum_1.OrderStatus.DELIVERED]: [order_status_enum_1.OrderStatus.DISPUTED, order_status_enum_1.OrderStatus.RETURN_REQUESTED],
    [order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED]: [order_status_enum_1.OrderStatus.DELIVERED, order_status_enum_1.OrderStatus.DISPUTED, order_status_enum_1.OrderStatus.RETURN_REQUESTED],
    [order_status_enum_1.OrderStatus.DISPUTED]: [order_status_enum_1.OrderStatus.RETURN_REQUESTED],
};
const SAR_VAT_RATE = 0.15;
let OrdersService = OrdersService_1 = class OrdersService {
    constructor(orderRepo, orderItemRepo, returnRepo, commentRepo, inventoryItemRepo, catalogRepo, tenantRepo, dataSource, eventEmitter) {
        this.orderRepo = orderRepo;
        this.orderItemRepo = orderItemRepo;
        this.returnRepo = returnRepo;
        this.commentRepo = commentRepo;
        this.inventoryItemRepo = inventoryItemRepo;
        this.catalogRepo = catalogRepo;
        this.tenantRepo = tenantRepo;
        this.dataSource = dataSource;
        this.eventEmitter = eventEmitter;
        this.logger = new common_1.Logger(OrdersService_1.name);
    }
    async findAll(user, filters = {}) {
        const qb = this.orderRepo
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.items', 'items')
            .leftJoinAndSelect('items.product', 'product')
            .leftJoinAndSelect('order.pharmacyTenant', 'pharmacyTenant')
            .leftJoinAndSelect('order.supplierTenant', 'supplierTenant');
        if (user.role === role_enum_1.Role.PHARMACY_ADMIN) {
            qb.where('order.pharmacyTenantId = :tenantId', { tenantId: user.tenantId });
        }
        else if (user.role === role_enum_1.Role.SUPPLIER_ADMIN) {
            qb.where('order.supplierTenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (filters.status)
            qb.andWhere('order.status = :status', { status: filters.status });
        if (filters.supplierTenantId)
            qb.andWhere('order.supplierTenantId = :sid', { sid: filters.supplierTenantId });
        if (filters.from)
            qb.andWhere('order.createdAt >= :from', { from: filters.from });
        if (filters.to)
            qb.andWhere('order.createdAt <= :to', { to: filters.to });
        const [data, total] = await qb
            .orderBy('order.createdAt', 'DESC')
            .take(Math.min(filters.take ?? 50, 200))
            .skip(filters.skip ?? 0)
            .getManyAndCount();
        return { data, total };
    }
    async findOne(user, id) {
        const order = await this.orderRepo.findOne({
            where: { id },
            relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'],
        });
        if (!order)
            throw new common_1.NotFoundException(`Order ${id} not found`);
        this.assertAccess(user, order);
        return order;
    }
    async create(pharmacyTenantId, dto, user) {
        if (!dto.items?.length)
            throw new common_1.BadRequestException('Order must have at least one item');
        for (const item of dto.items) {
            const catalogEntry = await this.catalogRepo
                .createQueryBuilder('c')
                .leftJoinAndSelect('c.product', 'product')
                .where('c.supplierTenantId = :supplierTenantId', { supplierTenantId: dto.supplierTenantId })
                .andWhere('c.productId = :productId', { productId: item.productId })
                .getOne();
            const product = catalogEntry?.product;
            if (product?.controlledSubstanceSchedule != null && !dto.pharmacistAcknowledged) {
                throw new common_1.BadRequestException(`Product "${product.name}" is a Saudi MOH Schedule ${product.controlledSubstanceSchedule} controlled substance. ` +
                    `A licensed pharmacist must verify this order. Pass pharmacistAcknowledged: true to confirm.`);
            }
            if (product?.hasDrugInteractionRisk && !dto.interactionRiskAcknowledged) {
                throw new common_1.BadRequestException(`Product "${product.name}" has known drug interaction risks. ` +
                    `${product.drugInteractionNotes ?? ''} ` +
                    `Review patient medication list and pass interactionRiskAcknowledged: true to confirm.`);
            }
        }
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
                throw new common_1.BadRequestException(`An open order for product ${item.productId} with this supplier already exists (${duplicate.id}). ` +
                    `Pass allowDuplicate: true to override.`);
            }
            const listing = await this.catalogRepo.findOne({
                where: { supplierTenantId: dto.supplierTenantId, productId: item.productId, isAvailable: true },
            });
            if (!listing) {
                throw new common_1.BadRequestException(`Supplier does not carry product ${item.productId} or it is unavailable`);
            }
        }
        const subtotalAmount = dto.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
        const vatAmount = Math.round(subtotalAmount * SAR_VAT_RATE * 100) / 100;
        const totalAmount = Math.round((subtotalAmount + vatAmount) * 100) / 100;
        const tenant = await this.tenantRepo.findOne({ where: { id: pharmacyTenantId } });
        const threshold = tenant?.orderApprovalThresholdSar;
        const needsApproval = threshold && totalAmount > Number(threshold);
        const initialStatus = needsApproval ? order_status_enum_1.OrderStatus.PENDING_APPROVAL : order_status_enum_1.OrderStatus.SUBMITTED;
        const qr = this.dataSource.createQueryRunner();
        await qr.connect();
        await qr.startTransaction('READ COMMITTED');
        try {
            const historyEntry = {
                from: 'created', to: initialStatus, changedBy: user.id, changedByRole: user.role,
                at: new Date().toISOString(), reason: needsApproval ? 'Approval required above threshold' : undefined,
            };
            const order = qr.manager.create(order_entity_1.Order, {
                pharmacyTenantId,
                supplierTenantId: dto.supplierTenantId,
                notes: dto.notes,
                currency: 'SAR',
                subtotalAmount,
                vatRate: SAR_VAT_RATE,
                vatAmount,
                totalAmount,
                status: initialStatus,
                changeHistory: [historyEntry],
            });
            const savedOrder = await qr.manager.save(order_entity_1.Order, order);
            await qr.manager.save(order_item_entity_1.OrderItem, dto.items.map((i) => qr.manager.create(order_item_entity_1.OrderItem, {
                orderId: savedOrder.id,
                productId: i.productId,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                totalPrice: Number(i.quantity) * Number(i.unitPrice),
            })));
            await qr.commitTransaction();
            if (needsApproval) {
                this.eventEmitter.emit('order.approval_required', { orderId: savedOrder.id, pharmacyTenantId, totalAmount });
            }
            else {
                this.eventEmitter.emit('order.submitted', { orderId: savedOrder.id, pharmacyTenantId, supplierTenantId: dto.supplierTenantId });
            }
            return this.orderRepo.findOne({
                where: { id: savedOrder.id },
                relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'],
            });
        }
        catch (err) {
            await qr.rollbackTransaction();
            throw err;
        }
        finally {
            await qr.release();
        }
    }
    async updateStatus(user, id, newStatus, opts = {}) {
        const order = await this.orderRepo.findOne({
            where: { id },
            relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'],
        });
        if (!order)
            throw new common_1.NotFoundException(`Order ${id} not found`);
        if (user.role === role_enum_1.Role.SUPPLIER_ADMIN && order.supplierTenantId !== user.tenantId)
            throw new common_1.ForbiddenException();
        if (user.role === role_enum_1.Role.PHARMACY_ADMIN && order.pharmacyTenantId !== user.tenantId)
            throw new common_1.ForbiddenException();
        const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
        if (!allowed.includes(newStatus)) {
            throw new common_1.BadRequestException(`Cannot transition order from "${order.status}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none'}`);
        }
        const historyEntry = {
            from: order.status, to: newStatus, changedBy: user.id,
            changedByRole: user.role, at: new Date().toISOString(), reason: opts.reason,
        };
        const updatePayload = {
            status: newStatus,
            changeHistory: [...(order.changeHistory ?? []), historyEntry],
        };
        if (newStatus === order_status_enum_1.OrderStatus.CANCELLED)
            updatePayload.cancellationReason = opts.reason ?? null;
        if (newStatus === order_status_enum_1.OrderStatus.COUNTER_OFFER)
            updatePayload.counterOfferNotes = opts.counterOfferNotes ?? null;
        if (newStatus === order_status_enum_1.OrderStatus.DISPUTED) {
            updatePayload.disputeReason = opts.reason;
            updatePayload.disputeOpenedAt = new Date();
        }
        if (newStatus === order_status_enum_1.OrderStatus.ON_HOLD)
            updatePayload.onHoldReason = opts.reason ?? null;
        if ([order_status_enum_1.OrderStatus.DELIVERED, order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED, order_status_enum_1.OrderStatus.CREDIT_ISSUED].includes(newStatus)) {
            updatePayload.disputeResolvedAt = new Date();
        }
        const previousStatus = order.status;
        const qr = this.dataSource.createQueryRunner();
        await qr.connect();
        await qr.startTransaction('SERIALIZABLE');
        try {
            await qr.manager.update(order_entity_1.Order, id, updatePayload);
            if (DELIVERY_STATUSES.has(newStatus)) {
                for (const item of order.items) {
                    const accepted = item.quantityAccepted != null
                        ? Number(item.quantityAccepted)
                        : Number(item.quantity);
                    if (accepted <= 0)
                        continue;
                    const existing = await qr.manager.findOne(inventory_item_entity_1.InventoryItem, {
                        where: { pharmacyTenantId: order.pharmacyTenantId, productId: item.productId, deletedAt: null },
                        lock: { mode: 'pessimistic_write' },
                    });
                    if (existing) {
                        await qr.manager.update(inventory_item_entity_1.InventoryItem, existing.id, { quantity: Number(existing.quantity) + accepted });
                    }
                    else {
                        await qr.manager.save(inventory_item_entity_1.InventoryItem, qr.manager.create(inventory_item_entity_1.InventoryItem, {
                            pharmacyTenantId: order.pharmacyTenantId, productId: item.productId, quantity: accepted, minThreshold: 10,
                        }));
                    }
                }
                this.logger.log(`Inventory updated for ${order.pharmacyTenantId} — order ${id} → ${newStatus}`);
            }
            await qr.commitTransaction();
        }
        catch (err) {
            await qr.rollbackTransaction();
            throw err;
        }
        finally {
            await qr.release();
        }
        this.eventEmitter.emit(domain_events_1.EVENTS.ORDER_STATUS_CHANGED, new domain_events_1.OrderStatusChangedEvent(id, order.pharmacyTenantId, order.supplierTenantId, previousStatus, newStatus));
        if (newStatus === order_status_enum_1.OrderStatus.DELIVERED || newStatus === order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED) {
            this.eventEmitter.emit(domain_events_1.EVENTS.ORDER_DELIVERED, new domain_events_1.OrderDeliveredEvent(id, order.pharmacyTenantId, order.supplierTenantId, order.items
                .filter((i) => (i.quantityAccepted ?? i.quantity) > 0)
                .map((i) => ({ productId: i.productId, quantity: i.quantityAccepted ?? i.quantity, unitPrice: Number(i.unitPrice) }))));
        }
        if (newStatus === order_status_enum_1.OrderStatus.RETURN_REQUESTED)
            this.eventEmitter.emit('order.return_requested', { orderId: id, pharmacyTenantId: order.pharmacyTenantId });
        if (newStatus === order_status_enum_1.OrderStatus.DISPUTED)
            this.eventEmitter.emit('order.disputed', { orderId: id, reason: opts.reason });
        return this.orderRepo.findOne({ where: { id }, relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'] });
    }
    async approve(user, id) {
        const order = await this.orderRepo.findOne({ where: { id } });
        if (!order)
            throw new common_1.NotFoundException(`Order ${id} not found`);
        if (order.pharmacyTenantId !== user.tenantId)
            throw new common_1.ForbiddenException();
        if (order.status !== order_status_enum_1.OrderStatus.PENDING_APPROVAL) {
            throw new common_1.BadRequestException('Order is not pending approval');
        }
        const historyEntry = {
            from: order_status_enum_1.OrderStatus.PENDING_APPROVAL, to: order_status_enum_1.OrderStatus.SUBMITTED,
            changedBy: user.id, changedByRole: user.role, at: new Date().toISOString(),
            reason: 'Director approved',
        };
        await this.orderRepo.update(id, {
            status: order_status_enum_1.OrderStatus.SUBMITTED,
            approvedByUserId: user.id,
            approvedAt: new Date(),
            changeHistory: [...(order.changeHistory ?? []), historyEntry],
        });
        this.eventEmitter.emit('order.submitted', { orderId: id, pharmacyTenantId: order.pharmacyTenantId, supplierTenantId: order.supplierTenantId });
        return this.orderRepo.findOne({ where: { id }, relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'] });
    }
    async confirmReceipt(user, id, items, opts = {}) {
        const order = await this.orderRepo.findOne({ where: { id }, relations: ['items'] });
        if (!order)
            throw new common_1.NotFoundException();
        if (order.pharmacyTenantId !== user.tenantId)
            throw new common_1.ForbiddenException();
        if (order.status !== order_status_enum_1.OrderStatus.RECEIVED_PENDING_QC) {
            throw new common_1.BadRequestException('Order must be in RECEIVED_PENDING_QC status to confirm receipt');
        }
        for (const item of items) {
            const orderItem = order.items.find((i) => i.id === item.orderItemId);
            if (!orderItem)
                throw new common_1.BadRequestException(`OrderItem ${item.orderItemId} not found on this order`);
            if (item.quantityAccepted < 0)
                throw new common_1.BadRequestException('quantityAccepted cannot be negative');
            if ((item.quantityRejected ?? 0) < 0)
                throw new common_1.BadRequestException('quantityRejected cannot be negative');
            const totalReceived = item.quantityAccepted + (item.quantityRejected ?? 0);
            if (totalReceived > Number(orderItem.quantity)) {
                throw new common_1.BadRequestException(`Total received (${totalReceived}) exceeds ordered quantity (${orderItem.quantity}) for item ${item.orderItemId}`);
            }
        }
        for (const item of items) {
            await this.orderItemRepo.update(item.orderItemId, {
                quantityAccepted: item.quantityAccepted,
                quantityRejected: item.quantityRejected ?? 0,
                quantityReceived: item.quantityAccepted + (item.quantityRejected ?? 0),
                rejectionReason: item.rejectionReason ?? null,
                batchNumber: item.batchNumber ?? null,
                expiryDateOnBatch: item.expiryDateOnBatch ? new Date(item.expiryDateOnBatch) : null,
            });
        }
        const totalAccepted = items.reduce((s, i) => s + i.quantityAccepted, 0);
        const totalRejected = items.reduce((s, i) => s + (i.quantityRejected ?? 0), 0);
        const newStatus = totalAccepted === 0
            ? order_status_enum_1.OrderStatus.DISPUTED
            : totalRejected > 0 ? order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED : order_status_enum_1.OrderStatus.DELIVERED;
        if (opts.deliveryProofUrl || opts.recipientName) {
            await this.orderRepo.update(id, {
                deliveryProofUrl: opts.deliveryProofUrl,
                deliveryTimestamp: new Date(),
                recipientName: opts.recipientName,
            });
        }
        return this.updateStatus(user, id, newStatus, { reason: `Received: ${totalAccepted} accepted, ${totalRejected} rejected` });
    }
    async addComment(user, orderId, body, authorName) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order)
            throw new common_1.NotFoundException();
        this.assertAccess(user, order);
        const comment = this.commentRepo.create({
            orderId, authorId: user.id, authorRole: user.role,
            authorName: authorName ?? null, body, isSystemMessage: false,
        });
        return this.commentRepo.save(comment);
    }
    async getComments(user, orderId) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order)
            throw new common_1.NotFoundException();
        this.assertAccess(user, order);
        return this.commentRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    }
    async initiateReturn(user, orderId, items) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order)
            throw new common_1.NotFoundException();
        if (order.pharmacyTenantId !== user.tenantId)
            throw new common_1.ForbiddenException();
        const returnReq = this.returnRepo.create({
            orderId,
            pharmacyTenantId: order.pharmacyTenantId,
            supplierTenantId: order.supplierTenantId,
            requestedByUserId: user.id,
            items,
        });
        const saved = await this.returnRepo.save(returnReq);
        await this.updateStatus(user, orderId, order_status_enum_1.OrderStatus.RETURN_REQUESTED, { reason: `Return requested for ${items.length} item(s)` });
        return saved;
    }
    async getReturnRequests(orderId) {
        return this.returnRepo.find({ where: { orderId }, order: { createdAt: 'DESC' } });
    }
    assertAccess(user, order) {
        if (user.role === role_enum_1.Role.PHARMACY_ADMIN && order.pharmacyTenantId !== user.tenantId)
            throw new common_1.ForbiddenException('Access denied');
        if (user.role === role_enum_1.Role.SUPPLIER_ADMIN && order.supplierTenantId !== user.tenantId)
            throw new common_1.ForbiddenException('Access denied');
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = OrdersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __param(1, (0, typeorm_1.InjectRepository)(order_item_entity_1.OrderItem)),
    __param(2, (0, typeorm_1.InjectRepository)(order_return_request_entity_1.OrderReturnRequest)),
    __param(3, (0, typeorm_1.InjectRepository)(order_comment_entity_1.OrderComment)),
    __param(4, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(5, (0, typeorm_1.InjectRepository)(supplier_catalog_item_entity_1.SupplierCatalogItem)),
    __param(6, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource,
        event_emitter_1.EventEmitter2])
], OrdersService);
//# sourceMappingURL=orders.service.js.map
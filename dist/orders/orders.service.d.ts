import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderReturnRequest, ReturnItem } from './entities/order-return-request.entity';
import { OrderComment } from './entities/order-comment.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus } from '../common/enums/order-status.enum';
export declare class OrdersService {
    private orderRepo;
    private orderItemRepo;
    private returnRepo;
    private commentRepo;
    private inventoryItemRepo;
    private catalogRepo;
    private tenantRepo;
    private readonly dataSource;
    private readonly eventEmitter;
    private readonly logger;
    constructor(orderRepo: Repository<Order>, orderItemRepo: Repository<OrderItem>, returnRepo: Repository<OrderReturnRequest>, commentRepo: Repository<OrderComment>, inventoryItemRepo: Repository<InventoryItem>, catalogRepo: Repository<SupplierCatalogItem>, tenantRepo: Repository<Tenant>, dataSource: DataSource, eventEmitter: EventEmitter2);
    findAll(user: {
        role: string;
        tenantId: string;
    }, filters?: {
        status?: string;
        supplierTenantId?: string;
        from?: Date;
        to?: Date;
        take?: number;
        skip?: number;
    }): Promise<{
        data: Order[];
        total: number;
    }>;
    findOne(user: {
        role: string;
        tenantId: string;
    }, id: string): Promise<Order>;
    create(pharmacyTenantId: string, dto: CreateOrderDto, user: {
        id: string;
        role: string;
    }): Promise<Order>;
    updateStatus(user: {
        id: string;
        role: string;
        tenantId: string;
    }, id: string, newStatus: OrderStatus, opts?: {
        reason?: string;
        counterOfferNotes?: string;
    }): Promise<Order>;
    approve(user: {
        id: string;
        role: string;
        tenantId: string;
    }, id: string): Promise<Order>;
    confirmReceipt(user: {
        id: string;
        role: string;
        tenantId: string;
    }, id: string, items: Array<{
        orderItemId: string;
        quantityAccepted: number;
        quantityRejected?: number;
        rejectionReason?: string;
        batchNumber?: string;
        expiryDateOnBatch?: string;
    }>, opts?: {
        deliveryProofUrl?: string;
        recipientName?: string;
    }): Promise<Order>;
    addComment(user: {
        id: string;
        role: string;
        tenantId: string;
    }, orderId: string, body: string, authorName?: string): Promise<OrderComment>;
    getComments(user: {
        role: string;
        tenantId: string;
    }, orderId: string): Promise<OrderComment[]>;
    initiateReturn(user: {
        id: string;
        role: string;
        tenantId: string;
    }, orderId: string, items: ReturnItem[]): Promise<OrderReturnRequest>;
    getReturnRequests(orderId: string): Promise<OrderReturnRequest[]>;
    private assertAccess;
}

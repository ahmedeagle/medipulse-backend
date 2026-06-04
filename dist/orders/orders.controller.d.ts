import { OrdersService } from './orders.service';
import { InvoiceService } from './invoice.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
declare class ReceiveItemDto {
    orderItemId: string;
    quantityAccepted: number;
    quantityRejected?: number;
    rejectionReason?: string;
    batchNumber?: string;
    expiryDateOnBatch?: string;
}
declare class ConfirmReceiptDto {
    items: ReceiveItemDto[];
    deliveryProofUrl?: string;
    recipientName?: string;
}
declare class OrderActionDto {
    reason?: string;
}
declare class AddCommentDto {
    body: string;
}
declare class ReturnItemDto {
    orderItemId: string;
    productId: string;
    quantity: number;
    returnReason: string;
}
declare class InitiateReturnDto {
    items: ReturnItemDto[];
}
export declare class OrdersController {
    private readonly ordersService;
    private readonly invoiceService;
    constructor(ordersService: OrdersService, invoiceService: InvoiceService);
    findAll(user: any, status?: string, supplierTenantId?: string, from?: string, to?: string, take?: number, skip?: number): Promise<{
        data: import("./entities/order.entity").Order[];
        total: number;
    }>;
    findOne(user: any, id: string): Promise<import("./entities/order.entity").Order>;
    create(user: any, dto: CreateOrderDto): Promise<import("./entities/order.entity").Order>;
    updateStatus(user: any, id: string, dto: UpdateOrderStatusDto): Promise<import("./entities/order.entity").Order>;
    approve(user: any, id: string): Promise<import("./entities/order.entity").Order>;
    confirmReceipt(user: any, id: string, dto: ConfirmReceiptDto): Promise<import("./entities/order.entity").Order>;
    dispute(user: any, id: string, dto: OrderActionDto): Promise<import("./entities/order.entity").Order>;
    hold(user: any, id: string, dto: OrderActionDto): Promise<import("./entities/order.entity").Order>;
    initiateReturn(user: any, id: string, dto: InitiateReturnDto): Promise<import("./entities/order-return-request.entity").OrderReturnRequest>;
    getReturns(id: string): Promise<import("./entities/order-return-request.entity").OrderReturnRequest[]>;
    getComments(user: any, id: string): Promise<import("./entities/order-comment.entity").OrderComment[]>;
    getInvoice(id: string): Promise<import("./entities/invoice.entity").Invoice>;
    addComment(user: any, id: string, dto: AddCommentDto): Promise<import("./entities/order-comment.entity").OrderComment>;
}
export {};

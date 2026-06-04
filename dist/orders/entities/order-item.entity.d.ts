import { Order } from './order.entity';
import { Product } from '../../inventory/entities/product.entity';
export declare class OrderItem {
    id: string;
    orderId: string;
    order: Order;
    productId: string;
    product: Product;
    quantity: number;
    quantityReceived: number | null;
    quantityAccepted: number | null;
    quantityRejected: number | null;
    rejectionReason: string | null;
    batchNumber: string | null;
    expiryDateOnBatch: Date | null;
    unitPrice: number;
    totalPrice: number;
}

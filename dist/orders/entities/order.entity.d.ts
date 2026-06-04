import { OrderStatus } from '../../common/enums/order-status.enum';
import { Tenant } from '../../auth/entities/tenant.entity';
import { OrderItem } from './order-item.entity';
export interface OrderHistoryEntry {
    from: string;
    to: string;
    changedBy: string;
    changedByRole: string;
    at: string;
    reason?: string;
}
export declare class Order {
    id: string;
    pharmacyTenantId: string;
    pharmacyTenant: Tenant;
    supplierTenantId: string;
    supplierTenant: Tenant;
    status: OrderStatus;
    currency: string;
    subtotalAmount: number;
    vatRate: number;
    vatAmount: number;
    totalAmount: number;
    approvalThresholdSar: number;
    approvedByUserId: string;
    approvedAt: Date;
    notes: string;
    cancellationReason: string;
    rejectionReason: string;
    counterOfferNotes: string;
    disputeReason: string;
    disputeOpenedAt: Date;
    disputeResolvedAt: Date;
    onHoldReason: string;
    deliveryProofUrl: string;
    deliveryTimestamp: Date;
    recipientName: string;
    changeHistory: OrderHistoryEntry[];
    items: OrderItem[];
    createdAt: Date;
    updatedAt: Date;
}

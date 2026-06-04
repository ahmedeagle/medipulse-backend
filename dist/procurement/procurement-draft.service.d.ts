import { Repository, DataSource } from 'typeorm';
import { ProcurementDraft } from './entities/procurement-draft.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
export declare class ProcurementDraftService {
    private readonly draftRepo;
    private readonly recRepo;
    private readonly catalogRepo;
    private readonly scoreRepo;
    private readonly inventoryRepo;
    private readonly orderRepo;
    private readonly orderItemRepo;
    private readonly dataSource;
    private readonly logger;
    constructor(draftRepo: Repository<ProcurementDraft>, recRepo: Repository<AiRecommendation>, catalogRepo: Repository<SupplierCatalogItem>, scoreRepo: Repository<SupplierReliabilityScore>, inventoryRepo: Repository<InventoryItem>, orderRepo: Repository<Order>, orderItemRepo: Repository<OrderItem>, dataSource: DataSource);
    generateFromRecommendation(recommendationId: string, tenantId: string): Promise<ProcurementDraft | null>;
    findPending(pharmacyTenantId: string): Promise<ProcurementDraft[]>;
    getProcurementQueue(pharmacyTenantId: string): Promise<{
        criticalDrafts: ProcurementDraft[];
        expiringStock: InventoryItem[];
        pendingOrders: Order[];
    }>;
    approveDraft(pharmacyTenantId: string, draftId: string): Promise<Order>;
    rejectDraft(pharmacyTenantId: string, draftId: string, reason?: string): Promise<ProcurementDraft>;
    expireStaleDrafts(): Promise<void>;
    private findOwned;
}

import { Repository } from 'typeorm';
import { ProcurementSchedule } from './entities/procurement-schedule.entity';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { PreferredSupplier } from '../supplier/entities/preferred-supplier.entity';
import { Tenant } from '../auth/entities/tenant.entity';
export interface EoqResult {
    eoqQty: number;
    safetyStockQty: number;
    reorderPoint: number;
    effectiveLeadTimeDays: number;
    recommendedSupplierTenantId?: string;
    reorderByDate?: Date;
    predictedStockoutDate?: Date;
    daysUntilReorderNeeded?: number;
}
export declare class EoqService {
    private readonly scheduleRepo;
    private readonly snapshotRepo;
    private readonly inventoryRepo;
    private readonly catalogRepo;
    private readonly scoreRepo;
    private readonly preferredRepo;
    private readonly tenantRepo;
    constructor(scheduleRepo: Repository<ProcurementSchedule>, snapshotRepo: Repository<ConsumptionSnapshot>, inventoryRepo: Repository<InventoryItem>, catalogRepo: Repository<SupplierCatalogItem>, scoreRepo: Repository<SupplierReliabilityScore>, preferredRepo: Repository<PreferredSupplier>, tenantRepo: Repository<Tenant>);
    refreshAllSchedules(): Promise<void>;
    refreshForPharmacy(tenantId: string): Promise<void>;
    calculateEoq(tenantId: string, productId: string, currentQuantity: number): Promise<EoqResult>;
    getScheduleMap(tenantId: string, productIds: string[]): Promise<Map<string, ProcurementSchedule>>;
    private getBestSupplier;
    private upsertSchedule;
}

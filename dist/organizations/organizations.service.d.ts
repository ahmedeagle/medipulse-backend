import { Repository, DataSource } from 'typeorm';
import { Organization, OrganizationType } from './entities/organization.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../common/enums/order-status.enum';
export declare class OrganizationsService {
    private readonly orgRepo;
    private readonly tenantRepo;
    private readonly inventoryRepo;
    private readonly orderRepo;
    private readonly dataSource;
    constructor(orgRepo: Repository<Organization>, tenantRepo: Repository<Tenant>, inventoryRepo: Repository<InventoryItem>, orderRepo: Repository<Order>, dataSource: DataSource);
    create(dto: {
        name: string;
        slug: string;
        type: OrganizationType;
    }): Promise<Organization>;
    findAll(): Promise<Organization[]>;
    addBranch(organizationId: string, tenantId: string, branchRole?: 'branch' | 'central'): Promise<Tenant>;
    removeBranch(tenantId: string): Promise<Tenant>;
    getBranches(organizationId: string): Promise<Tenant[]>;
    getAggregatedInventory(organizationId: string): Promise<{
        tenantId: string;
        tenantName: string;
        lowStockItems: InventoryItem[];
    }[]>;
    getAggregatedOrders(organizationId: string, statusFilter?: OrderStatus[]): Promise<Order[]>;
    getSpendAnalytics(organizationId: string): Promise<{
        branchId: string;
        branchName: string;
        totalSpend: number;
        orderCount: number;
        currency: string;
    }[]>;
}

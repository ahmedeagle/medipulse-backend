import { OrganizationsService } from './organizations.service';
import { OrganizationType } from './entities/organization.entity';
declare class CreateOrganizationDto {
    name: string;
    slug: string;
    type: OrganizationType;
}
declare class AddBranchDto {
    tenantId: string;
    branchRole?: 'branch' | 'central';
}
export declare class OrganizationsController {
    private readonly svc;
    constructor(svc: OrganizationsService);
    create(dto: CreateOrganizationDto): Promise<import("./entities/organization.entity").Organization>;
    findAll(): Promise<import("./entities/organization.entity").Organization[]>;
    addBranch(orgId: string, dto: AddBranchDto): Promise<import("../auth/entities/tenant.entity").Tenant>;
    removeBranch(tenantId: string): Promise<import("../auth/entities/tenant.entity").Tenant>;
}
export declare class ChainAdminController {
    private readonly svc;
    constructor(svc: OrganizationsService);
    getBranches(user: any): Promise<import("../auth/entities/tenant.entity").Tenant[]>;
    getAggregatedInventory(user: any): Promise<{
        tenantId: string;
        tenantName: string;
        lowStockItems: import("../inventory/entities/inventory-item.entity").InventoryItem[];
    }[]>;
    getOrders(user: any): Promise<import("../orders/entities/order.entity").Order[]>;
    getSpend(user: any): Promise<{
        branchId: string;
        branchName: string;
        totalSpend: number;
        orderCount: number;
        currency: string;
    }[]>;
}
export {};

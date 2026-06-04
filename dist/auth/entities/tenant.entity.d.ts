import { TenantType } from '../../common/enums/tenant-type.enum';
export type BranchRole = 'branch' | 'central' | 'standalone';
export declare class Tenant {
    id: string;
    name: string;
    slug: string;
    type: TenantType;
    isActive: boolean;
    organizationId: string;
    branchRole: BranchRole;
    city: string;
    region: string;
    createdAt: Date;
    users: any[];
}

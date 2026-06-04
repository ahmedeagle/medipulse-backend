import { Role } from '../../common/enums/role.enum';
import { Tenant } from './tenant.entity';
export declare class User {
    id: string;
    kcId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    isActive: boolean;
    tenantId: string;
    tenant: Tenant;
    createdAt: Date;
}

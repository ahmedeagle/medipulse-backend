import { TenantType } from '../../common/enums/tenant-type.enum';
export declare class RegisterDto {
    email: string;
    firstName: string;
    lastName: string;
    tenantName: string;
    tenantType: TenantType;
}

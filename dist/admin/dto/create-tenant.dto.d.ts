import { TenantType } from '../../common/enums/tenant-type.enum';
export declare class CreateTenantDto {
    name: string;
    slug: string;
    type: TenantType;
}

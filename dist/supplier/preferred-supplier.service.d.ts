import { Repository } from 'typeorm';
import { PreferredSupplier } from './entities/preferred-supplier.entity';
import { SupplierProfile } from './entities/supplier-profile.entity';
export declare class PreferredSupplierService {
    private readonly repo;
    private readonly profileRepo;
    constructor(repo: Repository<PreferredSupplier>, profileRepo: Repository<SupplierProfile>);
    connect(pharmacyTenantId: string, supplierTenantId: string, priority?: number, notes?: string): Promise<PreferredSupplier>;
    disconnect(pharmacyTenantId: string, supplierTenantId: string): Promise<void>;
    listForPharmacy(pharmacyTenantId: string): Promise<PreferredSupplier[]>;
    getPriorityList(pharmacyTenantId: string): Promise<string[]>;
}

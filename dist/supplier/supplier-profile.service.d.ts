import { Repository } from 'typeorm';
import { SupplierProfile, ProfileStatus } from './entities/supplier-profile.entity';
export declare class SupplierProfileService {
    private readonly repo;
    constructor(repo: Repository<SupplierProfile>);
    upsert(supplierTenantId: string, dto: Partial<Omit<SupplierProfile, 'id' | 'supplierTenantId' | 'status' | 'verifiedAt' | 'rejectionReason' | 'createdAt' | 'updatedAt'>>): Promise<SupplierProfile>;
    getOwn(supplierTenantId: string): Promise<SupplierProfile | null>;
    findById(supplierTenantId: string): Promise<SupplierProfile>;
    findAll(status?: ProfileStatus): Promise<SupplierProfile[]>;
    findByZone(region: string): Promise<SupplierProfile[]>;
    verify(supplierTenantId: string): Promise<SupplierProfile>;
    reject(supplierTenantId: string, reason: string): Promise<SupplierProfile>;
    suspend(supplierTenantId: string): Promise<SupplierProfile>;
}

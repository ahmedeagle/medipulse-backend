import { Repository, DataSource } from 'typeorm';
import { SupplierReliabilityScore } from './entities/supplier-reliability-score.entity';
import { Tenant } from '../auth/entities/tenant.entity';
export declare class SupplierReliabilityService {
    private readonly scoreRepo;
    private readonly tenantRepo;
    private readonly dataSource;
    private readonly logger;
    constructor(scoreRepo: Repository<SupplierReliabilityScore>, tenantRepo: Repository<Tenant>, dataSource: DataSource);
    recalculateAll(): Promise<void>;
    calculateScore(supplierTenantId: string): Promise<SupplierReliabilityScore>;
    getScore(supplierTenantId: string): Promise<SupplierReliabilityScore | null>;
    getScores(supplierTenantIds: string[]): Promise<Map<string, SupplierReliabilityScore>>;
    private upsertScore;
}

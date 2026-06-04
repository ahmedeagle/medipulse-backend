import { Repository, DataSource } from 'typeorm';
import { PriceSnapshot } from './entities/price-snapshot.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { SupplierProfile } from '../supplier/entities/supplier-profile.entity';
import { WeeklyAnalyticsSnapshot } from './entities/weekly-analytics-snapshot.entity';
export interface DemandSignal {
    productId: string;
    productName: string;
    category: string;
    severity: 'critical' | 'high' | 'medium';
    affectedCount: number;
    regionCount: number;
}
export interface PricePoint {
    date: string;
    price: number;
    currency: string;
    stockAtTime: number | null;
}
export interface RegionalPrice {
    supplierTenantId: string;
    region: string;
    latestPrice: number;
    currency: string;
    priceChange30d: number | null;
}
export declare class AnalyticsReadService {
    private readonly priceSnapshotRepo;
    private readonly inventoryRepo;
    private readonly tenantRepo;
    private readonly profileRepo;
    private readonly snapshotRepo;
    private readonly dataSource;
    constructor(priceSnapshotRepo: Repository<PriceSnapshot>, inventoryRepo: Repository<InventoryItem>, tenantRepo: Repository<Tenant>, profileRepo: Repository<SupplierProfile>, snapshotRepo: Repository<WeeklyAnalyticsSnapshot>, dataSource: DataSource);
    getDemandSignalsForSupplier(supplierTenantId: string, deliveryZones: string[]): Promise<DemandSignal[]>;
    getPriceTrend(supplierTenantId: string, productId: string, days?: number): Promise<PricePoint[]>;
    getRegionalPricing(productId: string): Promise<RegionalPrice[]>;
    getWeeklySnapshots(tenantId: string, weeks?: number): Promise<WeeklyAnalyticsSnapshot[]>;
}

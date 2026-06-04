import { SupplierProfileService } from './supplier-profile.service';
import { PreferredSupplierService } from './preferred-supplier.service';
import { CatalogImportService } from './catalog-import.service';
import { AnalyticsReadService } from '../analytics/analytics-read.service';
import { ProfileStatus } from './entities/supplier-profile.entity';
declare class UpsertProfileDto {
    companyName: string;
    registrationNumber?: string;
    licenseNumber?: string;
    licenseExpiryDate?: Date;
    address?: string;
    phone?: string;
    website?: string;
    deliveryZones?: string[];
    minOrderAmount?: number;
    maxDeliveryDays?: number;
    paymentTerms?: string;
    certifications?: any[];
}
declare class ConnectSupplierDto {
    supplierTenantId: string;
    priority?: number;
    notes?: string;
}
declare class RejectProfileDto {
    reason: string;
}
export declare class SupplierProfileController {
    private readonly profileSvc;
    constructor(profileSvc: SupplierProfileService);
    getOwn(user: any): Promise<import("./entities/supplier-profile.entity").SupplierProfile>;
    upsert(user: any, dto: UpsertProfileDto): Promise<import("./entities/supplier-profile.entity").SupplierProfile>;
    findAll(): Promise<import("./entities/supplier-profile.entity").SupplierProfile[]>;
    findOne(id: string): Promise<import("./entities/supplier-profile.entity").SupplierProfile>;
}
export declare class SupplierProfileAdminController {
    private readonly profileSvc;
    constructor(profileSvc: SupplierProfileService);
    findAll(status?: ProfileStatus): Promise<import("./entities/supplier-profile.entity").SupplierProfile[]>;
    verify(id: string): Promise<import("./entities/supplier-profile.entity").SupplierProfile>;
    reject(id: string, dto: RejectProfileDto): Promise<import("./entities/supplier-profile.entity").SupplierProfile>;
    suspend(id: string): Promise<import("./entities/supplier-profile.entity").SupplierProfile>;
}
export declare class PreferredSupplierController {
    private readonly preferredSvc;
    constructor(preferredSvc: PreferredSupplierService);
    list(user: any): Promise<import("./entities/preferred-supplier.entity").PreferredSupplier[]>;
    connect(user: any, dto: ConnectSupplierDto): Promise<import("./entities/preferred-supplier.entity").PreferredSupplier>;
    disconnect(user: any, sid: string): Promise<void>;
}
export declare class CatalogImportController {
    private readonly importSvc;
    constructor(importSvc: CatalogImportService);
    importCsv(user: any, file: Express.Multer.File): Promise<import("./catalog-import.service").ImportResult>;
}
export declare class DemandSignalsController {
    private readonly profileSvc;
    private readonly analyticsSvc;
    constructor(profileSvc: SupplierProfileService, analyticsSvc: AnalyticsReadService);
    getDemandSignals(user: any): Promise<import("../analytics/analytics-read.service").DemandSignal[]>;
}
export {};

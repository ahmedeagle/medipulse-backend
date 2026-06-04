import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupplierCatalogItem } from './entities/supplier-catalog-item.entity';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
export declare class SupplierService {
    private catalogRepository;
    private readonly eventEmitter;
    constructor(catalogRepository: Repository<SupplierCatalogItem>, eventEmitter: EventEmitter2);
    findMyCatalog(supplierTenantId: string): Promise<SupplierCatalogItem[]>;
    findAllCatalog(): Promise<SupplierCatalogItem[]>;
    findCatalogForPharmacy(productIds: string[]): Promise<SupplierCatalogItem[]>;
    findCatalogByProduct(productId: string): Promise<SupplierCatalogItem[]>;
    create(supplierTenantId: string, dto: CreateCatalogItemDto): Promise<SupplierCatalogItem>;
    update(supplierTenantId: string, id: string, dto: UpdateCatalogItemDto): Promise<SupplierCatalogItem>;
    remove(supplierTenantId: string, id: string): Promise<{
        message: string;
    }>;
}

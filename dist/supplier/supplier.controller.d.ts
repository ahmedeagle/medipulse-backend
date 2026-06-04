import { SupplierService } from './supplier.service';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
export declare class SupplierController {
    private readonly supplierService;
    constructor(supplierService: SupplierService);
    getCatalog(user: any): Promise<import("./entities/supplier-catalog-item.entity").SupplierCatalogItem[]>;
    create(user: any, dto: CreateCatalogItemDto): Promise<import("./entities/supplier-catalog-item.entity").SupplierCatalogItem>;
    update(user: any, id: string, dto: UpdateCatalogItemDto): Promise<import("./entities/supplier-catalog-item.entity").SupplierCatalogItem>;
    remove(user: any, id: string): Promise<{
        message: string;
    }>;
}

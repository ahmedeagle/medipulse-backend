import { InventoryService } from './inventory.service';
import { InventoryImportService } from './inventory-import.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateProductDto } from './dto/create-product.dto';
export declare class InventoryController {
    private readonly inventoryService;
    private readonly importService;
    private readonly barcodeSvc;
    constructor(inventoryService: InventoryService, importService: InventoryImportService, barcodeSvc: BarcodeLookupService);
    findAll(user: any): Promise<import("./entities/inventory-item.entity").InventoryItem[]>;
    findLowStock(user: any): Promise<import("./entities/inventory-item.entity").InventoryItem[]>;
    create(user: any, dto: CreateInventoryItemDto): Promise<import("./entities/inventory-item.entity").InventoryItem>;
    update(user: any, id: string, dto: UpdateInventoryItemDto): Promise<import("./entities/inventory-item.entity").InventoryItem>;
    remove(user: any, id: string): Promise<{
        message: string;
    }>;
    importInventory(user: any, file: Express.Multer.File): Promise<import("./inventory-import.service").InventoryImportResult>;
    lookupBarcode(barcode: string): Promise<import("./barcode-lookup.service").BarcodeLookupResult>;
    findAllProducts(search?: string, take?: number, skip?: number): Promise<{
        data: import("./entities/product.entity").Product[];
        total: number;
    }>;
    createProduct(user: any, dto: CreateProductDto): Promise<import("./entities/product.entity").Product>;
}

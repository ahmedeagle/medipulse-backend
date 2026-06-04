import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryItem } from './entities/inventory-item.entity';
import { Product } from './entities/product.entity';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateProductDto } from './dto/create-product.dto';
export declare class InventoryService {
    private inventoryItemRepository;
    private productRepository;
    private readonly eventEmitter;
    constructor(inventoryItemRepository: Repository<InventoryItem>, productRepository: Repository<Product>, eventEmitter: EventEmitter2);
    findAll(tenantId: string): Promise<InventoryItem[]>;
    findLowStock(tenantId: string): Promise<InventoryItem[]>;
    create(tenantId: string, dto: CreateInventoryItemDto): Promise<InventoryItem>;
    update(tenantId: string, id: string, dto: UpdateInventoryItemDto): Promise<InventoryItem>;
    remove(tenantId: string, id: string): Promise<{
        message: string;
    }>;
    createProduct(dto: CreateProductDto): Promise<Product>;
    findAllProducts(search?: string, take?: number, skip?: number): Promise<{
        data: Product[];
        total: number;
    }>;
    findProductById(id: string): Promise<Product>;
}

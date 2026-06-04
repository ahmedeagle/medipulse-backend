import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
export interface BarcodeLookupResult {
    found: boolean;
    source: 'local_db' | 'open_food_facts' | 'not_found';
    productId?: string;
    name?: string;
    genericName?: string;
    manufacturer?: string;
    strength?: string;
    dosageForm?: string;
    category?: string;
    unit?: string;
}
export declare class BarcodeLookupService {
    private readonly productRepo;
    private readonly logger;
    constructor(productRepo: Repository<Product>);
    lookup(barcode: string): Promise<BarcodeLookupResult>;
    private guessCategory;
}

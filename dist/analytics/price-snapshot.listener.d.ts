import { Repository } from 'typeorm';
import { PriceSnapshot } from './entities/price-snapshot.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierStockChangedEvent } from '../events/domain-events';
export declare class PriceSnapshotListener {
    private readonly snapshotRepo;
    private readonly catalogRepo;
    private readonly logger;
    constructor(snapshotRepo: Repository<PriceSnapshot>, catalogRepo: Repository<SupplierCatalogItem>);
    onSupplierStockChanged(event: SupplierStockChangedEvent): Promise<void>;
}

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PriceSnapshot } from './entities/price-snapshot.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierStockChangedEvent, EVENTS } from '../events/domain-events';

/**
 * Records a price snapshot whenever a supplier updates their catalog.
 * Only writes if the price actually changed (avoids duplicate snapshots for
 * stock-only updates that don't affect pricing).
 */
@Injectable()
export class PriceSnapshotListener {
  private readonly logger = new Logger(PriceSnapshotListener.name);

  constructor(
    @InjectRepository(PriceSnapshot)
    private readonly snapshotRepo: Repository<PriceSnapshot>,
    @InjectRepository(SupplierCatalogItem)
    private readonly catalogRepo: Repository<SupplierCatalogItem>,
  ) {}

  @OnEvent(EVENTS.SUPPLIER_STOCK_CHANGED)
  async onSupplierStockChanged(event: SupplierStockChangedEvent): Promise<void> {
    try {
      // Check if price actually changed vs the last recorded snapshot
      const lastSnapshot = await this.snapshotRepo
        .createQueryBuilder('s')
        .where('s.supplierTenantId = :supplierTenantId', { supplierTenantId: event.supplierTenantId })
        .andWhere('s.productId = :productId', { productId: event.productId })
        .orderBy('s.recordedAt', 'DESC')
        .getOne();

      if (lastSnapshot && Number(lastSnapshot.price) === event.price) return; // no price change

      await this.snapshotRepo.save(
        this.snapshotRepo.create({
          supplierTenantId: event.supplierTenantId,
          productId:        event.productId,
          price:            event.price,
          stockAtTime:      event.stock,
        }),
      );
    } catch (err: any) {
      this.logger.error(`PriceSnapshot write failed: ${err.message}`);
    }
  }
}

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryItem } from './entities/inventory-item.entity';
import { ProductBatch } from './entities/product-batch.entity';
import { CreateBatchDto } from './dto/create-batch.dto';
import { InventoryUpdatedEvent, EVENTS } from '../events/domain-events';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';

/**
 * Multi-batch inventory management.
 *
 * Each pharmacy inventory row aggregates one or more ProductBatch lots:
 *   - inventory_items.quantity      = SUM(batches.quantity WHERE status='active')
 *   - inventory_items.batchNumber   = batchNumber of the FEFO (soonest expiry) active lot
 *   - inventory_items.expiryDate    = expiryDate    of that lot
 *   - inventory_items.costPrice     = weighted-average cost across active lots
 *   - inventory_items.sellingPrice  = sellingPrice of the FEFO active lot
 *
 * This enables full traceability (SFDA / recall), accurate FEFO dispensing,
 * and proper weighted-average COGS reporting — without changing the existing
 * inventory_items API surface.
 */
@Injectable()
export class BatchesService {
  constructor(
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(ProductBatch)
    private readonly batchRepo: Repository<ProductBatch>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** List active batches for one inventory item, FEFO-ordered, paginated. */
  async listForItem(
    tenantId: string,
    inventoryItemId: string,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<ProductBatch>> {
    const item = await this.inventoryRepo.findOne({
      where: { id: inventoryItemId, deletedAt: IsNull() },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (item.pharmacyTenantId !== tenantId) {
      throw new ForbiddenException('You do not have access to this inventory item');
    }
    const { limit, offset } = normalizePagination(pagination);
    const [data, total] = await this.batchRepo
      .createQueryBuilder('b')
      .where('b.inventoryItemId = :id', { id: item.id })
      .orderBy(
        // FEFO: soonest expiry first, NULLs last
        'CASE WHEN b.expiryDate IS NULL THEN 1 ELSE 0 END',
        'ASC',
      )
      .addOrderBy('b.expiryDate', 'ASC')
      .addOrderBy('b.createdAt', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();
    return { data, total, limit, offset };
  }

  /** Create a new batch and recompute the parent inventory aggregate. */
  async create(
    tenantId: string,
    userId: string,
    inventoryItemId: string,
    dto: CreateBatchDto,
  ): Promise<{ batch: ProductBatch; inventory: InventoryItem }> {
    if (!dto.batchNumber?.trim()) {
      throw new BadRequestException('batchNumber is required');
    }
    if (!dto.quantity || dto.quantity < 1) {
      throw new BadRequestException('quantity must be a positive integer');
    }

    return this.dataSource.transaction(async (manager) => {
      const itemRepo  = manager.getRepository(InventoryItem);
      const batchRepo = manager.getRepository(ProductBatch);

      const item = await itemRepo.findOne({
        where: { id: inventoryItemId, deletedAt: IsNull() },
      });
      if (!item) throw new NotFoundException('Inventory item not found');
      if (item.pharmacyTenantId !== tenantId) {
        throw new ForbiddenException('You do not have access to this inventory item');
      }

      const batch = batchRepo.create({
        productId:        item.productId,
        pharmacyTenantId: tenantId,
        inventoryItemId:  item.id,
        batchNumber:      dto.batchNumber.trim(),
        quantity:         dto.quantity,
        receivedQuantity: dto.quantity,
        expiryDate:       dto.expiryDate        ? new Date(dto.expiryDate)        : null,
        manufacturingDate: dto.manufacturingDate ? new Date(dto.manufacturingDate) : null,
        location:         dto.location  || item.location || 'Main Warehouse',
        costPerUnit:      dto.costPerUnit  ?? item.costPrice    ?? null,
        sellingPrice:     dto.sellingPrice ?? item.sellingPrice ?? null,
        notes:            dto.notes?.trim() || null,
        createdByUserId:  userId,
        status:           'active',
      });
      const savedBatch = await batchRepo.save(batch);

      const previousQuantity = item.quantity;
      const updated = await this.recomputeAggregate(manager, item.id);

      if (updated.quantity !== previousQuantity) {
        this.eventEmitter.emit(
          EVENTS.INVENTORY_UPDATED,
          new InventoryUpdatedEvent(
            tenantId,
            item.productId,
            updated.quantity,
            previousQuantity,
            'adjustment',
          ),
        );
      }

      return { batch: savedBatch, inventory: updated };
    });
  }

  /**
   * Adjust the quantity of a single batch by a delta (positive = stock-in, negative = stock-out).
   * If the resulting quantity hits 0, the batch is marked depleted.
   * Then recomputes the parent inventory aggregate.
   */
  async adjustQuantity(
    tenantId: string,
    userId: string,
    batchId: string,
    delta: number,
    reason?: string,
  ): Promise<{ batch: ProductBatch; inventory: InventoryItem }> {
    if (!Number.isFinite(delta) || delta === 0) {
      throw new BadRequestException('delta must be a non-zero number');
    }

    return this.dataSource.transaction(async (manager) => {
      const itemRepo  = manager.getRepository(InventoryItem);
      const batchRepo = manager.getRepository(ProductBatch);

      const batch = await batchRepo.findOne({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.pharmacyTenantId !== tenantId) {
        throw new ForbiddenException('You do not have access to this batch');
      }

      const newQty = Number(batch.quantity || 0) + Number(delta);
      if (newQty < 0) {
        throw new BadRequestException(
          `Insufficient quantity in batch (current: ${batch.quantity}, requested delta: ${delta})`,
        );
      }

      batch.quantity = newQty;
      batch.updatedAt = new Date();
      if (newQty === 0) batch.status = 'depleted';
      if (reason && reason.trim()) {
        batch.notes = batch.notes
          ? `${batch.notes}\n[${new Date().toISOString()}] ${reason.trim()} (by ${userId}, Δ${delta})`
          : `[${new Date().toISOString()}] ${reason.trim()} (by ${userId}, Δ${delta})`;
      }
      const savedBatch = await batchRepo.save(batch);

      const item = await itemRepo.findOne({ where: { id: batch.inventoryItemId } });
      const previousQuantity = item?.quantity ?? 0;
      const updated = await this.recomputeAggregate(manager, batch.inventoryItemId);

      if (updated.quantity !== previousQuantity) {
        this.eventEmitter.emit(
          EVENTS.INVENTORY_UPDATED,
          new InventoryUpdatedEvent(
            tenantId,
            updated.productId,
            updated.quantity,
            previousQuantity,
            'adjustment',
          ),
        );
      }

      return { batch: savedBatch, inventory: updated };
    });
  }

  /** Update editable metadata of a batch. Recomputes parent (FEFO/cost may change). */
  async updateBatch(
    tenantId: string,
    _userId: string,
    batchId: string,
    patch: {
      batchNumber?: string;
      expiryDate?: string | null;
      location?: string | null;
      costPerUnit?: number;
      sellingPrice?: number;
      notes?: string | null;
    },
  ): Promise<{ batch: ProductBatch; inventory: InventoryItem }> {
    return this.dataSource.transaction(async (manager) => {
      const batchRepo = manager.getRepository(ProductBatch);

      const batch = await batchRepo.findOne({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.pharmacyTenantId !== tenantId) {
        throw new ForbiddenException('You do not have access to this batch');
      }

      if (patch.batchNumber !== undefined) batch.batchNumber = patch.batchNumber?.trim() || null;
      if (patch.expiryDate  !== undefined) batch.expiryDate  = patch.expiryDate ? new Date(patch.expiryDate) : null;
      if (patch.location    !== undefined) batch.location    = patch.location?.trim() || null;
      if (patch.costPerUnit !== undefined) batch.costPerUnit = patch.costPerUnit;
      if (patch.sellingPrice !== undefined) batch.sellingPrice = patch.sellingPrice;
      if (patch.notes       !== undefined) batch.notes       = patch.notes?.trim() || null;
      batch.updatedAt = new Date();

      const savedBatch = await batchRepo.save(batch);
      const updated = await this.recomputeAggregate(manager, batch.inventoryItemId);
      return { batch: savedBatch, inventory: updated };
    });
  }

  /** Soft-delete a batch (status='depleted', quantity=0) and recompute parent. */
  async removeBatch(
    tenantId: string,
    _userId: string,
    batchId: string,
  ): Promise<{ inventory: InventoryItem }> {
    return this.dataSource.transaction(async (manager) => {
      const itemRepo  = manager.getRepository(InventoryItem);
      const batchRepo = manager.getRepository(ProductBatch);

      const batch = await batchRepo.findOne({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.pharmacyTenantId !== tenantId) {
        throw new ForbiddenException('You do not have access to this batch');
      }

      batch.quantity = 0;
      batch.status = 'depleted';
      batch.updatedAt = new Date();
      await batchRepo.save(batch);

      const item = await itemRepo.findOne({ where: { id: batch.inventoryItemId } });
      const previousQuantity = item?.quantity ?? 0;
      const updated = await this.recomputeAggregate(manager, batch.inventoryItemId);

      if (updated.quantity !== previousQuantity) {
        this.eventEmitter.emit(
          EVENTS.INVENTORY_UPDATED,
          new InventoryUpdatedEvent(
            tenantId,
            updated.productId,
            updated.quantity,
            previousQuantity,
            'adjustment',
          ),
        );
      }

      return { inventory: updated };
    });
  }

  /** Recompute parent inventory_items row from its active batches. Returns updated row. */
  private async recomputeAggregate(manager: any, inventoryItemId: string): Promise<InventoryItem> {
    const itemRepo  = manager.getRepository(InventoryItem);
    const batchRepo = manager.getRepository(ProductBatch);

    const activeBatches: ProductBatch[] = await batchRepo
      .createQueryBuilder('b')
      .where('b.inventoryItemId = :id', { id: inventoryItemId })
      .andWhere('b.status = :s', { s: 'active' })
      .getMany();

    const totalQty = activeBatches.reduce((s, b) => s + Number(b.quantity || 0), 0);

    // Weighted-average cost across active lots (skip lots without cost).
    let weightedCost: number | null = null;
    const costed = activeBatches.filter(b => b.costPerUnit != null && Number(b.quantity) > 0);
    const costedQty = costed.reduce((s, b) => s + Number(b.quantity), 0);
    if (costedQty > 0) {
      const totalCost = costed.reduce((s, b) => s + Number(b.costPerUnit) * Number(b.quantity), 0);
      weightedCost = Number((totalCost / costedQty).toFixed(2));
    }

    // FEFO summary lot — soonest expiry, NULLs last, then earliest createdAt.
    const fefo = [...activeBatches].sort((a, b) => {
      const ax = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      const bx = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      if (ax !== bx) return ax - bx;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })[0];

    const patch: Partial<InventoryItem> = {
      quantity:     totalQty,
      batchNumber:  fefo?.batchNumber ?? null,
      expiryDate:   fefo?.expiryDate  ?? null,
      costPrice:    weightedCost,
      sellingPrice: fefo?.sellingPrice ?? null,
    };

    await itemRepo.update(inventoryItemId, patch);
    return itemRepo.findOne({ where: { id: inventoryItemId }, relations: ['product'] });
  }
}

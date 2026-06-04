import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductRecall, RecallType } from './entities/product-recall.entity';
import { ProductBatch } from './entities/product-batch.entity';
import { InventoryItem } from './entities/inventory-item.entity';
import { EVENTS } from '../events/domain-events';

export interface CreateRecallDto {
  productId:             string;
  batchNumber?:          string;
  recallType:            RecallType;
  recallReferenceNumber: string;
  description?:          string;
  effectiveAt?:          Date;
  resolutionDeadline?:   Date;
  createdByUserId?:      string;
}

@Injectable()
export class ProductRecallService {
  private readonly logger = new Logger(ProductRecallService.name);

  constructor(
    @InjectRepository(ProductRecall)
    private readonly recallRepo: Repository<ProductRecall>,
    @InjectRepository(ProductBatch)
    private readonly batchRepo: Repository<ProductBatch>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateRecallDto): Promise<ProductRecall> {
    // Find all pharmacies currently holding this product/batch
    const inventoryQb = this.inventoryRepo
      .createQueryBuilder('i')
      .where('i.productId = :productId', { productId: dto.productId })
      .andWhere('i.quantity > 0')
      .andWhere('i.deletedAt IS NULL');

    const affectedInventory = await inventoryQb.getMany();
    const affectedPharmacyIds = [...new Set(affectedInventory.map((i) => i.pharmacyTenantId))];

    const recall = await this.recallRepo.save(
      this.recallRepo.create({
        productId:             dto.productId,
        batchNumber:           dto.batchNumber ?? null,
        recallType:            dto.recallType,
        recallReferenceNumber: dto.recallReferenceNumber,
        description:           dto.description ?? null,
        issuedAt:              new Date(),
        effectiveAt:           dto.effectiveAt ?? new Date(),
        resolutionDeadline:    dto.resolutionDeadline ?? null,
        affectedPharmacyIds,
        status:                'active',
        createdByUserId:       dto.createdByUserId ?? null,
      }),
    );

    // Mark affected batches as recalled (in transaction)
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const batchQb = qr.manager
        .createQueryBuilder(ProductBatch, 'b')
        .where('b.productId = :productId', { productId: dto.productId })
        .andWhere("b.status = 'active'");

      if (dto.batchNumber) {
        batchQb.andWhere('b.batchNumber = :batchNumber', { batchNumber: dto.batchNumber });
      }

      const affectedBatches = await batchQb.getMany();

      for (const batch of affectedBatches) {
        await qr.manager.update(ProductBatch, batch.id, {
          status:                'recalled',
          recallReferenceNumber: dto.recallReferenceNumber,
          recallIssuedAt:        new Date(),
          recallId:              recall.id,
        });
      }

      this.logger.log(
        `Recall ${recall.id}: ${affectedBatches.length} batch(es) marked recalled, ` +
        `${affectedPharmacyIds.length} pharmacies affected`,
      );

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // Emit event — ComplianceWorkflowService picks this up and notifies pharmacies
    this.eventEmitter.emit(EVENTS.PRODUCT_RECALLED, {
      recallId:            recall.id,
      productId:           dto.productId,
      batchNumber:         dto.batchNumber,
      recallType:          dto.recallType,
      recallReferenceNumber: dto.recallReferenceNumber,
      affectedPharmacyIds,
    });

    return recall;
  }

  async findAll(): Promise<ProductRecall[]> {
    return this.recallRepo.find({ order: { issuedAt: 'DESC' } });
  }

  async resolve(id: string): Promise<ProductRecall> {
    const recall = await this.recallRepo.findOne({ where: { id } });
    if (!recall) throw new NotFoundException(`Recall ${id} not found`);
    await this.recallRepo.update(id, { status: 'resolved', resolvedAt: new Date() });
    return this.recallRepo.findOne({ where: { id } });
  }
}

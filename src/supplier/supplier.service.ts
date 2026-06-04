import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupplierCatalogItem } from './entities/supplier-catalog-item.entity';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
import { SupplierStockChangedEvent, EVENTS } from '../events/domain-events';

@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(SupplierCatalogItem)
    private catalogRepository: Repository<SupplierCatalogItem>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findMyCatalog(supplierTenantId: string): Promise<SupplierCatalogItem[]> {
    return this.catalogRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.supplierTenantId = :supplierTenantId', { supplierTenantId })
      .andWhere('item.deletedAt IS NULL')
      .orderBy('product.name', 'ASC')
      .getMany();
  }

  async findAllCatalog(): Promise<SupplierCatalogItem[]> {
    return this.catalogRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.supplierTenant', 'supplierTenant')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.deletedAt IS NULL')
      .andWhere('item.isAvailable = true')
      .orderBy('product.name', 'ASC')
      .addOrderBy('item.price', 'ASC')
      .getMany();
  }

  /**
   * Scoped catalog fetch — only products relevant to the requesting pharmacy.
   * Used by the AI engine to avoid loading the entire network catalog on every run.
   * Critical fix: without this, every recommendation generation fetches ALL supplier
   * catalog items regardless of relevance (could be 100k+ rows at scale).
   */
  async findCatalogForPharmacy(productIds: string[]): Promise<SupplierCatalogItem[]> {
    if (!productIds.length) return [];
    return this.catalogRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.supplierTenant', 'supplierTenant')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.productId IN (:...productIds)', { productIds })
      .andWhere('item.deletedAt IS NULL')
      .andWhere('item.isAvailable = true')
      .orderBy('item.price', 'ASC')
      .getMany();
  }

  async findCatalogByProduct(productId: string): Promise<SupplierCatalogItem[]> {
    return this.catalogRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.supplierTenant', 'supplierTenant')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.productId = :productId', { productId })
      .andWhere('item.deletedAt IS NULL')
      .orderBy('item.price', 'ASC')
      .getMany();
  }

  async create(
    supplierTenantId: string,
    dto: CreateCatalogItemDto,
  ): Promise<SupplierCatalogItem> {
    const item = this.catalogRepository.create({
      supplierTenantId,
      productId: dto.productId,
      price: dto.price,
      isAvailable: dto.isAvailable !== undefined ? dto.isAvailable : true,
      stock: dto.stock !== undefined ? dto.stock : 0,
    });

    const saved = await this.catalogRepository.save(item);

    return this.catalogRepository.findOne({
      where: { id: saved.id },
      relations: ['product', 'supplierTenant'],
    });
  }

  async update(
    supplierTenantId: string,
    id: string,
    dto: UpdateCatalogItemDto,
  ): Promise<SupplierCatalogItem> {
    const item = await this.catalogRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });

    if (!item) {
      throw new NotFoundException(`Catalog item with ID ${id} not found`);
    }

    if (item.supplierTenantId !== supplierTenantId) {
      throw new ForbiddenException('You do not have access to this catalog item');
    }

    const updateData: Partial<SupplierCatalogItem> = {};
    if (dto.price !== undefined) updateData.price = dto.price;
    if (dto.isAvailable !== undefined) updateData.isAvailable = dto.isAvailable;
    if (dto.stock !== undefined) updateData.stock = dto.stock;

    await this.catalogRepository.update(id, updateData);

    const updated = await this.catalogRepository.findOne({
      where: { id },
      relations: ['product', 'supplierTenant'],
    });

    // Emit event whenever stock or availability changes
    if (dto.stock !== undefined || dto.price !== undefined) {
      this.eventEmitter.emit(
        EVENTS.SUPPLIER_STOCK_CHANGED,
        new SupplierStockChangedEvent(
          id,
          supplierTenantId,
          item.productId,
          dto.stock ?? Number(item.stock),
          dto.price !== undefined ? Number(dto.price) : Number(item.price),
        ),
      );
    }

    return updated;
  }

  async remove(supplierTenantId: string, id: string): Promise<{ message: string }> {
    const item = await this.catalogRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });

    if (!item) {
      throw new NotFoundException(`Catalog item with ID ${id} not found`);
    }

    if (item.supplierTenantId !== supplierTenantId) {
      throw new ForbiddenException('You do not have access to this catalog item');
    }

    await this.catalogRepository.update(id, { deletedAt: new Date() });

    return { message: 'Catalog item deleted successfully' };
  }
}

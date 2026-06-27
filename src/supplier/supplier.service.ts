import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupplierCatalogItem } from './entities/supplier-catalog-item.entity';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
import { SupplierStockChangedEvent, EVENTS } from '../events/domain-events';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';

export interface CatalogItemWithReliability extends SupplierCatalogItem {
  reliabilityScore:  number | null;
  reliabilityLabel:  string | null;
  avgDeliveryDays:   number | null;
}

@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(SupplierCatalogItem)
    private catalogRepository: Repository<SupplierCatalogItem>,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  async findMyCatalog(
    supplierTenantId: string,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<SupplierCatalogItem>> {
    const { limit, offset } = normalizePagination(pagination);
    const [data, total] = await this.catalogRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.supplierTenantId = :supplierTenantId', { supplierTenantId })
      .andWhere('item.deletedAt IS NULL')
      .orderBy('product.name', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();
    return { data, total, limit, offset };
  }

  async findAllCatalog(
    pagination: PaginationQueryDto = {},
    search?: string,
    supplierId?: string,
  ): Promise<PaginatedResult<CatalogItemWithReliability>> {
    const { limit, offset } = normalizePagination(pagination);
    const params: (string | number)[] = [limit, offset];
    let paramIdx = 3;

    const searchClause = search
      ? `AND (LOWER(p.name) LIKE $${paramIdx} OR LOWER(t.name) LIKE $${paramIdx} OR LOWER(p."genericName") LIKE $${paramIdx})`
      : '';
    if (search) { params.push(`%${search.toLowerCase()}%`); paramIdx++; }

    const supplierClause = supplierId ? `AND ci."supplierTenantId" = $${paramIdx}` : '';
    if (supplierId) { params.push(supplierId); paramIdx++; }

    const rows: Array<{
      id: string; supplierTenantId: string; productId: string; price: string; currency: string;
      isAvailable: boolean; stock: number; deletedAt: Date | null; updatedAt: Date; createdAt: Date;
      supplierName: string | null;
      productName: string | null; productGenericName: string | null; productCategory: string | null;
      productUnit: string | null;
      reliability_score: string | null; reliability_label: string | null;
      avg_delivery_days: string | null;
      total_count: string;
    }> = await this.dataSource.query(
      `
      SELECT
        ci.id, ci."supplierTenantId", ci."productId", ci.price, ci.currency,
        ci."isAvailable", ci.stock, ci."deletedAt", ci."updatedAt", ci."createdAt",
        t.name          AS "supplierName",
        p.name          AS "productName",
        p."genericName" AS "productGenericName",
        p.category      AS "productCategory",
        p.unit          AS "productUnit",
        rs."overallScore"::text     AS reliability_score,
        rs."reliabilityLabel"       AS reliability_label,
        rs."avgDeliveryDays"::text  AS avg_delivery_days,
        COUNT(*) OVER ()::text AS total_count
      FROM supplier_catalog ci
      LEFT JOIN tenants  t  ON t.id  = ci."supplierTenantId"
      LEFT JOIN products p  ON p.id  = ci."productId"
      LEFT JOIN supplier_reliability_scores rs
             ON rs."supplierTenantId" = ci."supplierTenantId"
            AND rs."productId" IS NULL
      WHERE ci."deletedAt" IS NULL
        AND ci."isAvailable" = true
        ${searchClause}
        ${supplierClause}
      ORDER BY p.name ASC, ci.price ASC
      LIMIT $1 OFFSET $2
      `,
      params,
    );

    const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;

    const data: CatalogItemWithReliability[] = rows.map((r) => ({
      id: r.id,
      supplierTenantId: r.supplierTenantId,
      productId: r.productId,
      price: parseFloat(r.price) as any,
      currency: r.currency,
      isAvailable: r.isAvailable,
      stock: r.stock,
      deletedAt: r.deletedAt,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
      supplierTenant: r.supplierName ? ({ id: r.supplierTenantId, name: r.supplierName } as any) : undefined,
      product: r.productName
        ? ({ id: r.productId, name: r.productName, genericName: r.productGenericName,
             category: r.productCategory, unit: r.productUnit } as any)
        : undefined,
      reliabilityScore: r.reliability_score ? parseFloat(r.reliability_score) : null,
      reliabilityLabel: r.reliability_label ?? null,
      avgDeliveryDays:  r.avg_delivery_days ? parseFloat(r.avg_delivery_days) : null,
    }));

    return { data, total, limit, offset };
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

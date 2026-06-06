import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryItem } from './entities/inventory-item.entity';
import { Product } from './entities/product.entity';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { InventoryUpdatedEvent, EVENTS } from '../events/domain-events';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem)
    private inventoryItemRepository: Repository<InventoryItem>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(tenantId: string): Promise<InventoryItem[]> {
    return this.inventoryItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('item.deletedAt IS NULL')
      .orderBy('product.name', 'ASC')
      .getMany();
  }

  async findLowStock(tenantId: string): Promise<InventoryItem[]> {
    return this.inventoryItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('item.deletedAt IS NULL')
      .andWhere('item.quantity <= item.minThreshold')
      .orderBy('item.quantity', 'ASC')
      .getMany();
  }

  /**
   * Count of items still in `unlinked` state — drives the Smart Link
   * batch.total so the progress bar has a denominator on the first poll.
   */
  async countUnlinked(tenantId: string): Promise<number> {
    return this.inventoryItemRepository.count({
      where: {
        pharmacyTenantId: tenantId,
        linkStatus: 'unlinked' as any,
      },
    });
  }

  async create(tenantId: string, dto: CreateInventoryItemDto): Promise<InventoryItem> {
    const product = await this.productRepository.findOne({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${dto.productId} not found`);
    }

    const item = this.inventoryItemRepository.create({
      pharmacyTenantId: tenantId,
      productId: dto.productId,
      quantity: dto.quantity,
      minThreshold: dto.minThreshold,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      // The user explicitly chose / created this catalog product, so the link
      // is authoritative. We intentionally do NOT set a synthetic match score:
      // a score is reserved for results from the AI matching engine. Direct
      // selection is recorded via matchExplanation.reasonKey instead.
      linkStatus: 'linked',
      matchScore: null,
      matchExplanation: {
        reasonKey: 'direct_catalog_selection',
        productId: product.id,
        requiresMapping: !!product.requiresMapping,
      } as any,
      lastLinkedAt: new Date(),
    });

    const saved = await this.inventoryItemRepository.save(item);

    return this.inventoryItemRepository.findOne({
      where: { id: saved.id },
      relations: ['product'],
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateInventoryItemDto,
  ): Promise<InventoryItem> {
    const item = await this.inventoryItemRepository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['product'],
    });

    if (!item) {
      throw new NotFoundException(`Inventory item with ID ${id} not found`);
    }

    if (item.pharmacyTenantId !== tenantId) {
      throw new ForbiddenException('You do not have access to this inventory item');
    }

    if (dto.productId && dto.productId !== item.productId) {
      const product = await this.productRepository.findOne({
        where: { id: dto.productId },
      });
      if (!product) {
        throw new NotFoundException(`Product with ID ${dto.productId} not found`);
      }
    }

    const previousQuantity = item.quantity;
    const updateData: Partial<InventoryItem> = {};
    if (dto.productId !== undefined) updateData.productId = dto.productId;
    if (dto.quantity !== undefined) updateData.quantity = dto.quantity;
    if (dto.minThreshold !== undefined) updateData.minThreshold = dto.minThreshold;
    if (dto.expiryDate !== undefined) updateData.expiryDate = new Date(dto.expiryDate);

    await this.inventoryItemRepository.update(id, updateData);

    const updated = await this.inventoryItemRepository.findOne({
      where: { id },
      relations: ['product'],
    });

    if (dto.quantity !== undefined && dto.quantity !== previousQuantity) {
      this.eventEmitter.emit(
        EVENTS.INVENTORY_UPDATED,
        new InventoryUpdatedEvent(
          tenantId,
          item.productId,
          dto.quantity,
          previousQuantity,
          'manual',
        ),
      );
    }

    return updated;
  }

  async remove(tenantId: string, id: string): Promise<{ message: string }> {
    const item = await this.inventoryItemRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });

    if (!item) {
      throw new NotFoundException(`Inventory item with ID ${id} not found`);
    }

    if (item.pharmacyTenantId !== tenantId) {
      throw new ForbiddenException('You do not have access to this inventory item');
    }

    await this.inventoryItemRepository.update(id, { deletedAt: new Date() });

    return { message: 'Inventory item deleted successfully' };
  }

  async createProduct(dto: CreateProductDto): Promise<Product> {
    // Defensive: enforce barcode uniqueness with a friendly error so pharmacy
    // admins are pointed at the existing canonical product instead of trying
    // to create a duplicate. This protects the master catalog from drift.
    if (dto.barcode && dto.barcode.trim()) {
      const existing = await this.productRepository.findOne({
        where: { barcode: dto.barcode.trim() },
      });
      if (existing) {
        throw new ConflictException({
          message: `الباركود "${dto.barcode}" مسجل بالفعل لمنتج آخر في الكتالوج. استخدم المنتج الموجود بدلاً من إنشاء نسخة جديدة.`,
          existingProductId: existing.id,
          existingProduct: {
            id: existing.id,
            name: existing.name,
            nameAr: existing.nameAr,
            manufacturer: existing.manufacturer,
            barcode: existing.barcode,
          },
          code: 'DUPLICATE_BARCODE',
        });
      }
    }
    const product = this.productRepository.create(dto);
    return this.productRepository.save(product);
  }

  async findAllProducts(search?: string, take = 50, skip = 0): Promise<{ data: Product[]; total: number }> {
    const qb = this.productRepository
      .createQueryBuilder('p')
      .orderBy('p.name', 'ASC')
      .take(Math.min(take, 200))
      .skip(skip);

    if (search?.trim()) {
      qb.where(
        '(LOWER(p.name) LIKE :q OR LOWER(p.genericName) LIKE :q OR LOWER(p.activeIngredient) LIKE :q OR p.barcode = :exact)',
        { q: `%${search.toLowerCase().trim()}%`, exact: search.trim() },
      );
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findProductById(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    return product;
  }

  // ── Catalog linking ─────────────────────────────────────────────────────────
  /**
   * Link an inventory item to a specific catalog product. Used when a pharmacist
   * confirms a suggested match or hand-picks a different product than the one
   * currently linked. Emits no stock event — quantity is unchanged.
   */
  async linkToProduct(
    tenantId: string,
    inventoryItemId: string,
    productId: string,
    opts: { score?: number; signals?: string[]; reasons?: string[]; manual?: boolean } = {},
  ): Promise<InventoryItem> {
    const item = await this.inventoryItemRepository.findOne({
      where: { id: inventoryItemId, deletedAt: IsNull() },
    });
    if (!item) throw new NotFoundException(`Inventory item ${inventoryItemId} not found`);
    if (item.pharmacyTenantId !== tenantId) {
      throw new ForbiddenException('You do not have access to this inventory item');
    }

    const product = await this.productRepository.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    await this.inventoryItemRepository.update(inventoryItemId, {
      productId:        product.id,
      linkStatus:       'linked',
      matchScore:       opts.score ?? (opts.manual ? 100 : 95),
      matchExplanation: {
        signals: opts.signals ?? (opts.manual ? ['manual_link'] : ['confirmed_match']),
        reasons: opts.reasons ?? [],
        manual:  !!opts.manual,
        previousProductId: item.productId,
      } as any,
      lastLinkedAt: new Date(),
    });

    return this.inventoryItemRepository.findOne({
      where: { id: inventoryItemId },
      relations: ['product'],
    });
  }

  /**
   * Detach an item from its current catalog product, marking it as `unlinked`.
   * The underlying productId reference is kept so the row remains valid, but
   * `linkStatus` flags it for matching/re-linking.
   */
  async unlinkFromCatalog(
    tenantId: string,
    inventoryItemId: string,
    reason?: string,
  ): Promise<InventoryItem> {
    const item = await this.inventoryItemRepository.findOne({
      where: { id: inventoryItemId, deletedAt: IsNull() },
    });
    if (!item) throw new NotFoundException(`Inventory item ${inventoryItemId} not found`);
    if (item.pharmacyTenantId !== tenantId) {
      throw new ForbiddenException('You do not have access to this inventory item');
    }

    await this.inventoryItemRepository.update(inventoryItemId, {
      linkStatus:       'unlinked',
      matchScore:       null,
      matchExplanation: { signals: ['user_unlinked'], reason: reason || null } as any,
    });

    return this.inventoryItemRepository.findOne({
      where: { id: inventoryItemId },
      relations: ['product'],
    });
  }
}


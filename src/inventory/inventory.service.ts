import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, IsNull } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryItem } from './entities/inventory-item.entity';
import { Product } from './entities/product.entity';
import { ProductBatch } from './entities/product-batch.entity';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateProductWithBatchDto } from './dto/create-product-with-batch.dto';
import { InventoryUpdatedEvent, EVENTS } from '../events/domain-events';
import { NotificationService } from '../notifications/notification.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';
import { CatalogMatchingService } from './catalog-matching.service';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';
import { MOVEMENT_POLICY } from './movement-policy';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem)
    private inventoryItemRepository: Repository<InventoryItem>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationService: NotificationService,
    private readonly settingsSvc: PharmacySettingsService,
    private readonly dataSource: DataSource,
    private readonly catalogMatching: CatalogMatchingService,
  ) {}

  async findAll(
    tenantId: string,
    pagination: PaginationQueryDto = {},
    q?: string,
    linkStatus?: string,
  ): Promise<PaginatedResult<InventoryItem>> {
    const { limit, offset } = normalizePagination(pagination);
    const qb = this.inventoryItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('item.deletedAt IS NULL');

    if (q?.trim()) {
      const like = `%${q.trim()}%`;
      qb.andWhere(
        '(product.name ILIKE :like OR product."nameAr" ILIKE :like OR product.barcode ILIKE :like OR product.sku ILIKE :like OR item."batchNumber" ILIKE :like)',
        { like },
      );
    }

    if (linkStatus) {
      qb.andWhere('item.linkStatus = :linkStatus', { linkStatus });
    }

    const [data, total] = await qb
      .orderBy('item.matchScore', 'DESC')
      .addOrderBy('product.name', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    const enriched = await this.attachMovementSignals(tenantId, data);
    return { data: enriched as InventoryItem[], total, limit, offset };
  }

  /**
   * Attach movement/dead-stock signals in one aggregated query for the current page.
   * This avoids per-item queries and keeps response time stable on large inventories.
   */
  private async attachMovementSignals(tenantId: string, items: InventoryItem[]): Promise<Array<InventoryItem & {
    lastSoldAt?: string | null;
    consumed8w?: number;
    daysSinceLastSale?: number | null;
    movementLabel?: 'active' | 'moderate' | 'stagnant';
    deadStockFlag?: boolean;
  }>> {
    if (!items.length) return items as any;

    const productIds = Array.from(new Set(items.map((i) => i.productId).filter(Boolean)));
    if (!productIds.length) return items as any;

    const rows: Array<{ productId: string; lastSoldWeek: string | null; consumed8w: string }> = await this.dataSource.query(
      `
      SELECT
        cs."productId" AS "productId",
        MAX(cs."weekStart") FILTER (WHERE cs."quantityConsumed" > 0) AS "lastSoldWeek",
        COALESCE(
          SUM(cs."quantityConsumed") FILTER (
            WHERE cs."weekStart" >= (CURRENT_DATE - ($3::int * INTERVAL '1 day'))
          ),
          0
        ) AS "consumed8w"
      FROM consumption_snapshots cs
      WHERE cs."tenantId" = $1
        AND cs."productId" = ANY($2::uuid[])
      GROUP BY cs."productId"
      `,
      [tenantId, productIds, MOVEMENT_POLICY.consumptionWindowDays],
    );

    const byProduct = new Map(
      rows.map((r) => [r.productId, {
        lastSoldWeek: r.lastSoldWeek ? new Date(r.lastSoldWeek) : null,
        consumed8w: Number(r.consumed8w) || 0,
      }]),
    );

    const now = Date.now();
    return items.map((item) => {
      const snap = byProduct.get(item.productId);
      if (!snap) {
        // No movement history yet (new product / no historical sales snapshots).
        // Keep classification neutral to avoid false dead-stock positives.
        return {
          ...item,
          lastSoldAt: null,
          consumed8w: undefined,
          daysSinceLastSale: null,
          movementLabel: undefined,
          deadStockFlag: false,
        };
      }

      const lastSoldAt = snap.lastSoldWeek ? snap.lastSoldWeek.toISOString() : null;
      const daysSinceLastSale = snap.lastSoldWeek
        ? Math.max(0, Math.floor((now - snap.lastSoldWeek.getTime()) / 86_400_000))
        : null;

      const movementLabel: 'active' | 'moderate' | 'stagnant' =
        daysSinceLastSale == null
          ? 'moderate'
          : daysSinceLastSale <= MOVEMENT_POLICY.activeDays
            ? 'active'
            : daysSinceLastSale <= MOVEMENT_POLICY.moderateDays
              ? 'moderate'
              : 'stagnant';

      const deadStockFlag =
        item.quantity > 0 &&
        (daysSinceLastSale ?? 0) >= MOVEMENT_POLICY.deadStockDays &&
        snap.consumed8w === 0;

      return {
        ...item,
        lastSoldAt,
        consumed8w: snap.consumed8w,
        daysSinceLastSale,
        movementLabel,
        deadStockFlag,
      };
    });
  }

  async findLowStock(
    tenantId: string,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<InventoryItem>> {
    const { limit, offset } = normalizePagination(pagination);
    const [data, total] = await this.inventoryItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('item.deletedAt IS NULL')
      .andWhere('item.quantity <= item.minThreshold')
      .orderBy('item.quantity', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();
    return { data, total, limit, offset };
  }

  async findExpired(
    tenantId: string,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<InventoryItem>> {
    const { limit, offset } = normalizePagination(pagination);
    const today = new Date().toISOString().slice(0, 10);
    const [data, total] = await this.inventoryItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('item.deletedAt IS NULL')
      .andWhere('item."expiryDate" IS NOT NULL')
      .andWhere('item."expiryDate" < :today', { today })
      .andWhere('item.quantity > 0')
      .orderBy('item."expiryDate"', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();
    return { data, total, limit, offset };
  }

  // Used by ExpiredInventoryCron — returns all expired items for a tenant without pagination
  async findExpiredForCron(tenantId: string): Promise<InventoryItem[]> {
    const today = new Date().toISOString().slice(0, 10);
    return this.inventoryItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('item.deletedAt IS NULL')
      .andWhere('item."expiryDate" IS NOT NULL')
      .andWhere('item."expiryDate" < :today', { today })
      .andWhere('item.quantity > 0')
      .getMany();
  }

  // Used by DeadStockCron — returns all tenants with inventory
  async findDistinctTenants(): Promise<string[]> {
    const rows = await this.inventoryItemRepository
      .createQueryBuilder('item')
      .select('DISTINCT item."pharmacyTenantId"', 'tenantId')
      .where('item.deletedAt IS NULL')
      .getRawMany<{ tenantId: string }>();
    return rows.map((r) => r.tenantId);
  }

  /**
   * Internal helper that returns EVERY active inventory item for a tenant
   * (no pagination). Used by background AI generation that needs the full
   * dataset; never exposed through HTTP. Public list endpoints must use
   * `findAll(tenantId, pagination)` to keep responses bounded.
   */
  async findAllForTenant(tenantId: string): Promise<InventoryItem[]> {
    return this.inventoryItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.pharmacyTenantId = :tenantId', { tenantId })
      .andWhere('item.deletedAt IS NULL')
      .orderBy('product.name', 'ASC')
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

  async countSuggested(tenantId: string): Promise<number> {
    return this.inventoryItemRepository.count({
      where: {
        pharmacyTenantId: tenantId,
        linkStatus: 'suggested' as any,
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
      // Catalog products (requiresMapping=false): user explicitly chose this product → link is authoritative.
      // Pharmacy-created products (requiresMapping=true): product is local-only, not yet matched to the
      // central catalog. Start as 'unlinked' so the AI matching engine will process it immediately.
      linkStatus: product.requiresMapping ? 'unlinked' : 'linked',
      matchScore: null,
      matchExplanation: {
        reasonKey: product.requiresMapping ? 'pharmacy_product_pending_match' : 'direct_catalog_selection',
        productId: product.id,
        requiresMapping: !!product.requiresMapping,
      } as any,
      lastLinkedAt: product.requiresMapping ? null : new Date(),
    });

    const saved = await this.inventoryItemRepository.save(item);

    // For pharmacy-created products, kick off catalog matching immediately so the item
    // surfaces in the "مقترح للمراجعة" filter without waiting for the nightly rematch job.
    if (product.requiresMapping) {
      this.catalogMatching.runForItem(tenantId, saved.id).catch(() => {});
    }

    const result = await this.inventoryItemRepository.findOne({
      where: { id: saved.id },
      relations: ['product'],
    });

    // Fire immediate alerts — don't wait for cron
    const productNameAr = (product as any).nameAr ?? product.name ?? 'منتج';
    const todayKey = new Date().toISOString().slice(0, 10);

    // Low stock: quantity already at or below threshold on creation
    const threshold = dto.minThreshold ?? 0;
    if (threshold > 0 && (dto.quantity ?? 0) <= threshold) {
      const alreadySent = await this.notificationService.findTodayLowStockAlert(
        tenantId, dto.productId, todayKey,
      );
      if (!alreadySent && await this.settingsSvc.getNotifFlag(tenantId, 'enableLowStockAlerts')) {
        await this.notificationService.create({
          tenantId,
          type: 'low_stock',
          title: `⚠️ مخزون منخفض: ${productNameAr}`,
          body: `الكمية المضافة ${dto.quantity ?? 0} وحدة — أقل من الحد الأدنى (${threshold} وحدة)`,
          resourceRef: `/pharmacy/inventory?productId=${dto.productId}`,
        });
      }
      // Emit domain event — LowStockCron listener creates an AI Center task immediately
      this.eventEmitter.emit(EVENTS.INVENTORY_LOW_STOCK_DETECTED, {
        tenantId,
        inventoryItemId: saved.id,
        productId:       dto.productId,
        productNameAr,
        quantity:        dto.quantity ?? 0,
        minThreshold:    threshold,
      });
      // Stockout: quantity = 0 → LostRevenueCron creates lost-revenue task immediately
      if ((dto.quantity ?? 0) === 0) {
        this.eventEmitter.emit(EVENTS.INVENTORY_STOCKOUT_DETECTED, {
          tenantId,
          inventoryItemId:  saved.id,
          productId:        dto.productId,
          productNameAr,
          previousQuantity: 0,
        });
      }
    }

    // Near expiry: expiry date within 90 days (conservative default — settings read by cron later)
    if (dto.expiryDate) {
      const expiryDate = new Date(dto.expiryDate);
      const daysToExpiry = Math.ceil(
        (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      if (daysToExpiry > 0 && daysToExpiry <= 90) {
        // Emit event — ExpiryLiquidationCron listener creates an AI Center task immediately
        this.eventEmitter.emit(EVENTS.INVENTORY_NEAR_EXPIRY_DETECTED, {
          tenantId,
          inventoryItemId: saved.id,
          productId:       dto.productId,
          productNameAr,
          quantity:        dto.quantity ?? 0,
          sellingPrice:    null,
          costPrice:       null,
          expiryDate:      expiryDate.toISOString(),
          daysToExpiry,
        });
      } else if (daysToExpiry <= 0) {
        if (await this.settingsSvc.getNotifFlag(tenantId, 'enableExpiryAlerts')) {
          await this.notificationService.create({
            tenantId,
            type: 'expired_stock',
            title: `🚨 منتج منتهي الصلاحية: ${productNameAr}`,
            body: `هذا المنتج انتهت صلاحيته — يجب عزله فوراً (الكمية: ${dto.quantity ?? 0} وحدة)`,
            resourceRef: `/pharmacy/inventory?productId=${dto.productId}`,
          });
        }
      }
    }

    // Emit inventory event so other listeners (AI bridge, P2P cron) react
    this.eventEmitter.emit(EVENTS.INVENTORY_UPDATED, {
      tenantId,
      productId: dto.productId,
      inventoryItemId: saved.id,
      quantity: dto.quantity ?? 0,
      minThreshold: threshold,
    });

    return result;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateInventoryItemDto,
  ): Promise<InventoryItem> {
    const item = await this.inventoryItemRepository.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: IsNull() },
      relations: ['product'],
    });

    if (!item) {
      throw new NotFoundException(`Inventory item with ID ${id} not found`);
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

      // Fire low-stock notification + domain event when quantity crosses below minThreshold
      const threshold = dto.minThreshold ?? item.minThreshold;
      if (previousQuantity > threshold && dto.quantity <= threshold) {
        const todayKey = new Date().toISOString().slice(0, 10);
        const alreadySent = await this.notificationService.findTodayLowStockAlert(
          tenantId, item.productId, todayKey,
        );
        const productNameAr = (updated as any).product?.nameAr ?? (updated as any).product?.name ?? 'منتج';
        if (!alreadySent && await this.settingsSvc.getNotifFlag(tenantId, 'enableLowStockAlerts')) {
          await this.notificationService.create({
            tenantId,
            type: 'low_stock',
            title: `⚠️ مخزون منخفض: ${productNameAr}`,
            body: `الكمية المتبقية ${dto.quantity} وحدة — أقل من الحد الأدنى (${threshold} وحدة). يُنصح بإعادة الطلب`,
            resourceRef: `/pharmacy/inventory?productId=${item.productId}`,
          });
        }
        // Emit domain event — LowStockCron listener creates an AI Center task immediately
        this.eventEmitter.emit(EVENTS.INVENTORY_LOW_STOCK_DETECTED, {
          tenantId,
          inventoryItemId: id,
          productId:       item.productId,
          productNameAr,
          quantity:        dto.quantity,
          minThreshold:    threshold,
        });
        // Stockout: quantity just hit 0 → LostRevenueCron creates lost-revenue task immediately
        if (dto.quantity === 0 && previousQuantity > 0) {
          this.eventEmitter.emit(EVENTS.INVENTORY_STOCKOUT_DETECTED, {
            tenantId,
            inventoryItemId:  id,
            productId:        item.productId,
            productNameAr,
            previousQuantity,
          });
        }
      }
    }

    // If expiryDate was just set/changed to within 90 days, trigger AI liquidation task immediately
    if (dto.expiryDate !== undefined) {
      const newExpiry = new Date(dto.expiryDate);
      const daysToExpiry = Math.ceil((newExpiry.getTime() - Date.now()) / 86_400_000);
      if (daysToExpiry > 0 && daysToExpiry <= 90) {
        const productNameAr = (updated as any).product?.nameAr ?? (updated as any).product?.name ?? 'منتج';
        const currentQty = dto.quantity ?? item.quantity;
        this.eventEmitter.emit(EVENTS.INVENTORY_NEAR_EXPIRY_DETECTED, {
          tenantId,
          inventoryItemId: id,
          productId:       item.productId,
          productNameAr,
          quantity:        currentQty,
          sellingPrice:    (updated as any).sellingPrice ?? null,
          costPrice:       (updated as any).costPrice ?? null,
          expiryDate:      newExpiry.toISOString(),
          daysToExpiry,
        });
      }
    }

    return updated;
  }

  async remove(tenantId: string, id: string): Promise<{ message: string }> {
    const item = await this.inventoryItemRepository.findOne({
      where: { id, pharmacyTenantId: tenantId, deletedAt: IsNull() },
    });

    if (!item) {
      throw new NotFoundException(`Inventory item with ID ${id} not found`);
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
    if (!dto.sku?.trim()) {
      // Atomic: read MAX numeric suffix to handle concurrent creates safely
      const result = await this.productRepository
        .createQueryBuilder('p')
        .select("MAX(CAST(NULLIF(REGEXP_REPLACE(p.sku, '[^0-9]', '', 'g'), '') AS INTEGER))", 'maxSku')
        .where("p.sku LIKE 'MED-%'")
        .getRawOne();
      const next = ((result?.maxSku as number | null) ?? 0) + 1;
      dto.sku = `MED-${String(next).padStart(6, '0')}`;
    }
    const product = this.productRepository.create(dto);
    return this.productRepository.save(product);
  }

  /**
   * F-07: WHO→Batch one-flow.
   * Creates product + first batch + inventory item in a single transaction.
   * If batchNumber / batchQuantity are omitted, falls back to product-only creation.
   */
  async createProductWithBatch(
    tenantId: string,
    userId: string,
    dto: CreateProductWithBatchDto,
  ): Promise<{ product: Product; inventoryItem?: InventoryItem; batch?: ProductBatch }> {
    // Create product first (SKU generation must be outside transaction to avoid lock contention)
    const product = await this.createProduct(dto);

    // If no batch fields supplied, return product only
    if (!dto.batchNumber?.trim() || !dto.batchQuantity || dto.batchQuantity < 1) {
      return { product };
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const itemRepo  = manager.getRepository(InventoryItem);
      const batchRepo = manager.getRepository(ProductBatch);

      // Create or upsert the inventory item
      let inventoryItem = await itemRepo.findOne({
        where: { productId: product.id, pharmacyTenantId: tenantId, deletedAt: IsNull() },
      });

      if (!inventoryItem) {
        inventoryItem = itemRepo.create({
          pharmacyTenantId: tenantId,
          productId:        product.id,
          quantity:         0,
          minThreshold:     dto.minThreshold ?? 10,
          linkStatus:       'linked',
          matchScore:       null,
          matchExplanation: { reasonKey: 'direct_catalog_selection', productId: product.id } as any,
          lastLinkedAt:     new Date(),
        });
        inventoryItem = await itemRepo.save(inventoryItem);
      }

      // Create the first batch
      const batch = batchRepo.create({
        productId:        product.id,
        pharmacyTenantId: tenantId,
        inventoryItemId:  inventoryItem.id,
        batchNumber:      dto.batchNumber!.trim(),
        quantity:         dto.batchQuantity!,
        receivedQuantity: dto.batchQuantity!,
        noExpiry:         dto.noExpiry ?? false,
        expiryDate:       dto.noExpiry ? null : (dto.expiryDate ? new Date(dto.expiryDate) : null),
        manufacturingDate: dto.manufacturingDate ? new Date(dto.manufacturingDate) : null,
        location:         dto.location ?? 'Main Warehouse',
        costPerUnit:      dto.costPerUnit ?? null,
        sellingPrice:     dto.sellingPrice ?? null,
        notes:            dto.batchNotes?.trim() ?? null,
        createdByUserId:  userId,
        status:           'active',
      });
      await batchRepo.save(batch);

      // Recompute inventory aggregate (FEFO: soonest expiry batch drives top-level fields)
      const activeBatches = await batchRepo.find({
        where: { inventoryItemId: inventoryItem.id, status: 'active' },
        order: { expiryDate: 'ASC' },
      });

      const totalQty = activeBatches.reduce((s, b) => s + Number(b.quantity), 0);
      const fefo = activeBatches.find(b => !b.noExpiry && b.expiryDate) ?? activeBatches[0];
      const weightedCost = activeBatches.length
        ? activeBatches.reduce((s, b) => s + Number(b.costPerUnit ?? 0) * Number(b.quantity), 0) / Math.max(totalQty, 1)
        : (dto.costPerUnit ?? 0);

      await itemRepo.update(inventoryItem.id, {
        quantity:      totalQty,
        minThreshold:  dto.minThreshold ?? inventoryItem.minThreshold ?? 10,
        expiryDate:    fefo?.expiryDate ?? null,
        batchNumber:   fefo?.batchNumber ?? null,
        costPrice:     weightedCost,
        sellingPrice:  fefo?.sellingPrice ?? inventoryItem.sellingPrice ?? null,
      });

      inventoryItem.quantity = totalQty;
      return { product, inventoryItem, batch };
    });

    // Emit events after transaction
    this.eventEmitter.emit(EVENTS.INVENTORY_UPDATED, new InventoryUpdatedEvent(
      tenantId, product.id, result.inventoryItem!.quantity, 0, 'adjustment',
    ));

    return result;
  }

  /**
   * F-05: Smart product table — returns products with aggregated batch stats.
   * Single query: LEFT JOIN product_batches aggregates per tenant.
   * Returns: batchCount, nearestExpiry, totalStock, stockStatus, barcodeWarning.
   */
  async findSmartProducts(
    tenantId: string,
    opts: { search?: string; status?: string; take?: number; skip?: number },
  ): Promise<{ data: any[]; total: number }> {
    const take = Math.min(opts.take ?? 25, 200);
    const skip = opts.skip ?? 0;
    const today = new Date().toISOString().slice(0, 10);

    const searchClause = opts.search?.trim()
      ? `AND (LOWER(p.name) LIKE :q OR LOWER(p."nameAr") LIKE :q OR LOWER(p."activeIngredient") LIKE :q OR p.barcode = :exact OR p.sku = :exact)`
      : '';

    const havingClause = (() => {
      switch (opts.status) {
        case 'out_of_stock':  return `HAVING COALESCE(SUM(b.quantity), 0) = 0`;
        case 'low_stock':     return `HAVING COALESCE(SUM(b.quantity), 0) > 0 AND COALESCE(SUM(b.quantity), 0) <= MAX(ii."minThreshold")`;
        case 'in_stock':      return `HAVING COALESCE(SUM(b.quantity), 0) > COALESCE(MAX(ii."minThreshold"), 10)`;
        case 'expiring_soon': return `HAVING MIN(CASE WHEN b."noExpiry" = false AND b."expiryDate" >= :today THEN b."expiryDate" ELSE NULL END) <= (CURRENT_DATE + INTERVAL '90 days')`;
        default: return '';
      }
    })();

    // Build positional parameter arrays for raw SQL
    const baseParams: any[] = [tenantId, today];
    let searchFilter = '';
    if (opts.search?.trim()) {
      // Use ILIKE (case-insensitive) instead of LOWER() LIKE — pg_trgm GIN indexes accelerate ILIKE at scale
      const q = `%${opts.search.trim()}%`;
      const exact = opts.search.trim();
      baseParams.push(q, exact);
      const qi = baseParams.length - 1;
      searchFilter = `AND (p.name ILIKE $${qi} OR p."nameAr" ILIKE $${qi} OR p."activeIngredient" ILIKE $${qi} OR p.barcode = $${qi + 1} OR p.sku = $${qi + 1})`;
    }

    const havingSQL = (() => {
      switch (opts.status) {
        case 'out_of_stock':  return `HAVING COALESCE(SUM(b.quantity), 0) = 0`;
        case 'low_stock':     return `HAVING COALESCE(SUM(b.quantity), 0) > 0 AND COALESCE(SUM(b.quantity), 0) <= COALESCE(MAX(ii."minThreshold"), 10)`;
        case 'in_stock':      return `HAVING COALESCE(SUM(b.quantity), 0) > COALESCE(MAX(ii."minThreshold"), 10)`;
        case 'expiring_soon': return `HAVING MIN(CASE WHEN b."noExpiry" = false AND b."expiryDate" >= $2::date THEN b."expiryDate" ELSE NULL END) <= (CURRENT_DATE + INTERVAL '90 days')`;
        default: return '';
      }
    })();

    const dataParams = [...baseParams, take, skip];
    const pTake = dataParams.length - 1;
    const pSkip = dataParams.length;

    const [dataRows, countRow] = await Promise.all([
      this.productRepository.manager.query(
        `
        SELECT
          p.id, p.name, p."nameAr", p.sku, p.barcode, p.category, p.unit,
          p."dosageForm", p.strength, p."activeIngredient", p.manufacturer,
          p."taxRate", p."isActive", p."disablePOSSale", p."disablePurchase",
          p."returnable", p."discountAllowed", p."requiresPrescription", p."createdAt", p."imageUrl",
          COUNT(b.id) FILTER (WHERE b.status = 'active' AND (b."noExpiry" = true OR b."expiryDate" >= $2::date)) AS "batchCount",
          COALESCE(SUM(b.quantity) FILTER (WHERE b."pharmacyTenantId" = $1 AND b.status = 'active'), 0) AS "totalStock",
          MIN(b."expiryDate") FILTER (WHERE b."pharmacyTenantId" = $1 AND b.status = 'active' AND b."noExpiry" = false AND b."expiryDate" >= $2::date) AS "nearestExpiry",
          COALESCE(MAX(ii."minThreshold"), 10) AS "minThreshold"
        FROM products p
        LEFT JOIN product_batches b ON b."productId" = p.id AND b."pharmacyTenantId" = $1
        LEFT JOIN inventory_items ii ON ii."productId" = p.id AND ii."pharmacyTenantId" = $1 AND ii."deletedAt" IS NULL
        WHERE p."isActive" = true
          ${searchFilter}
        GROUP BY p.id
        ${havingSQL}
        ORDER BY p.name ASC
        LIMIT $${pTake} OFFSET $${pSkip}
        `,
        dataParams,
      ),
      this.productRepository.manager.query(
        `
        SELECT COUNT(*) AS total
        FROM (
          SELECT p.id
          FROM products p
          LEFT JOIN product_batches b ON b."productId" = p.id AND b."pharmacyTenantId" = $1
          LEFT JOIN inventory_items ii ON ii."productId" = p.id AND ii."pharmacyTenantId" = $1 AND ii."deletedAt" IS NULL
          WHERE p."isActive" = true
            ${searchFilter}
          GROUP BY p.id
          ${havingSQL}
        ) sub
        `,
        baseParams,
      ),
    ]);

    const data = dataRows.map((row: any) => {
      const totalStock = Number(row.totalStock);
      const minThreshold = Number(row.minThreshold);
      let stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
      if (totalStock === 0) stockStatus = 'out_of_stock';
      else if (totalStock <= minThreshold) stockStatus = 'low_stock';
      else stockStatus = 'in_stock';

      return {
        ...row,
        batchCount:    Number(row.batchCount),
        totalStock,
        minThreshold,
        stockStatus,
        barcodeWarning: !row.barcode,
        nearestExpiry: row.nearestExpiry || null,
      };
    });

    return { data, total: Number(countRow[0]?.total ?? 0) };
  }

  async findAllProducts(search?: string, take = 25, skip = 0): Promise<{ data: Product[]; total: number }> {
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
      where: { id: inventoryItemId, pharmacyTenantId: tenantId, deletedAt: IsNull() },
    });
    if (!item) throw new NotFoundException(`Inventory item ${inventoryItemId} not found`);

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
      where: { id: inventoryItemId, pharmacyTenantId: tenantId, deletedAt: IsNull() },
    });
    if (!item) throw new NotFoundException(`Inventory item ${inventoryItemId} not found`);

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

  // ── F-08: Product image ──────────────────────────────────────────────────────

  async saveProductImage(productId: string, file: Express.Multer.File) {
    const product = await this.productRepository.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const uploadDir = path.join(process.cwd(), 'uploads', 'products');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
    const filename = `${productId}${ext}`;
    const filePath = path.join(uploadDir, filename);

    // Remove old file if different extension
    for (const oldExt of ['.jpg', '.jpeg', '.png', '.webp']) {
      const old = path.join(uploadDir, `${productId}${oldExt}`);
      if (old !== filePath && fs.existsSync(old)) fs.unlinkSync(old);
    }

    fs.writeFileSync(filePath, file.buffer);

    const imageUrl = `/uploads/products/${filename}`;
    await this.productRepository.update(productId, { imageUrl });
    return { imageUrl };
  }

  async removeProductImage(productId: string) {
    const product = await this.productRepository.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    if (product.imageUrl) {
      const filePath = path.join(process.cwd(), product.imageUrl.replace(/^\//, ''));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await this.productRepository.update(productId, { imageUrl: null as any });
    }
    return { success: true };
  }
}


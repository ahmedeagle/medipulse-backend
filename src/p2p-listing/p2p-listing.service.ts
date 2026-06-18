import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { P2pListing } from './entities/p2p-listing.entity';
import { ListingRulesEngine, RulesResult } from './listing-rules.engine';
import { CreateListingDto, UpdateListingDto } from './dto/create-listing.dto';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';

@Injectable()
export class P2pListingService {
  private readonly logger = new Logger(P2pListingService.name);

  constructor(
    @InjectRepository(P2pListing)
    private readonly repo: Repository<P2pListing>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Validate-only (live debounce, no save) ────────────────────────────────

  async validateOnly(
    sellerTenantId: string,
    dto: CreateListingDto,
    listingId?: string,
  ): Promise<RulesResult> {
    const { input } = await this.buildRuleInput(sellerTenantId, dto, listingId);
    return ListingRulesEngine.evaluate(input);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(
    sellerTenantId: string,
    dto: CreateListingDto,
  ): Promise<{ listing: P2pListing; issues: RulesResult }> {
    const { item, input } = await this.buildRuleInput(sellerTenantId, dto);
    const issues = ListingRulesEngine.evaluate(input);

    if (!issues.canPublish) {
      throw new BadRequestException({ message: 'Listing has blocking issues', issues });
    }

    const suggestedType = dto.listingType ?? this.suggestListingType(dto.expiryDate, dto.quantity);

    const listing = await this.repo.save(
      this.repo.create({
        sellerTenantId,
        inventoryItemId: dto.inventoryItemId,
        productId: item.productId,
        price: dto.price,
        quantity: dto.quantity,
        minOrderQty: dto.minOrderQty ?? 1,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        listingType: suggestedType,
        offerType: dto.offerType ?? 'none',
        discountPct: dto.discountPct ?? null,
        bonusQty: dto.bonusQty ?? null,
        autoUpdateDiscount: dto.autoUpdateDiscount ?? false,
        status: 'active',
      }),
    );

    return { listing, issues };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(
    sellerTenantId: string,
    listingId: string,
    dto: UpdateListingDto,
  ): Promise<{ listing: P2pListing; issues: RulesResult }> {
    const existing = await this.getOwnOrThrow(sellerTenantId, listingId);

    const merged: CreateListingDto = {
      inventoryItemId: existing.inventoryItemId,
      price: dto.price ?? Number(existing.price),
      quantity: dto.quantity ?? existing.quantity,
      minOrderQty: dto.minOrderQty ?? existing.minOrderQty,
      expiryDate: dto.expiryDate ?? (existing.expiryDate ? existing.expiryDate.toString() : undefined),
      listingType: dto.listingType ?? existing.listingType,
      offerType: dto.offerType ?? existing.offerType,
      discountPct: dto.discountPct ?? (existing.discountPct ? Number(existing.discountPct) : undefined),
      bonusQty: dto.bonusQty ?? existing.bonusQty,
      autoUpdateDiscount: dto.autoUpdateDiscount ?? existing.autoUpdateDiscount,
    };

    const { input } = await this.buildRuleInput(sellerTenantId, merged, listingId);
    const issues = ListingRulesEngine.evaluate(input);

    if (!issues.canPublish) {
      throw new BadRequestException({ message: 'Listing has blocking issues', issues });
    }

    await this.repo.update(listingId, {
      ...dto,
      updatedAt: new Date(),
    });

    const updated = await this.repo.findOne({ where: { id: listingId } });
    return { listing: updated, issues };
  }

  // ── Status mutations ──────────────────────────────────────────────────────

  async pause(sellerTenantId: string, listingId: string): Promise<P2pListing> {
    await this.getOwnOrThrow(sellerTenantId, listingId);
    await this.repo.update(listingId, { status: 'paused' });
    return this.repo.findOne({ where: { id: listingId } });
  }

  async resume(sellerTenantId: string, listingId: string): Promise<P2pListing> {
    await this.getOwnOrThrow(sellerTenantId, listingId);
    await this.repo.update(listingId, { status: 'active' });
    return this.repo.findOne({ where: { id: listingId } });
  }

  async softDelete(sellerTenantId: string, listingId: string): Promise<void> {
    await this.getOwnOrThrow(sellerTenantId, listingId);
    await this.repo.update(listingId, { status: 'expired' });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async findOwn(
    sellerTenantId: string,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<P2pListing & { productName?: string; productNameAr?: string; productCode?: string }>> {
    const { limit, offset } = normalizePagination(pagination);
    const [listings, total] = await this.repo.findAndCount({
      where: { sellerTenantId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    if (!listings.length) return { data: [], total, limit, offset };

    const inventoryIds = listings.map(l => l.inventoryItemId);
    const items = await this.inventoryRepo
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.product', 'product')
      .where('item.id IN (:...ids)', { ids: inventoryIds })
      .getMany();

    const itemMap = new Map(items.map(i => [i.id, i]));
    const data = listings.map(l => {
      const item = itemMap.get(l.inventoryItemId);
      return Object.assign(l, {
        productName:   item?.product?.name,
        productNameAr: (item?.product as any)?.nameAr,
        productCode:   item?.product?.sku || item?.product?.barcode,
        costPrice:     item?.costPrice ? Number(item.costPrice) : null,
      });
    });

    return { data, total, limit, offset };
  }

  async findOneWithIssues(
    sellerTenantId: string,
    listingId: string,
  ): Promise<{ listing: P2pListing; issues: RulesResult }> {
    const listing = await this.getOwnOrThrow(sellerTenantId, listingId);
    const item = await this.inventoryRepo.findOne({ where: { id: listing.inventoryItemId } });

    const rulesInput = {
      linkStatus: item?.linkStatus ?? 'unlinked',
      expiryDate: listing.expiryDate,
      quantity: listing.quantity,
      minOrderQty: listing.minOrderQty,
      price: Number(listing.price),
      costPrice: item?.costPrice ? Number(item.costPrice) : null,
      hasActiveDuplicate: false,
    };

    return { listing, issues: ListingRulesEngine.evaluate(rulesInput) };
  }

  // ── Inventory sync (called when InventoryUpdatedEvent fires) ──────────────

  async syncQuantityFromInventory(inventoryItemId: string): Promise<void> {
    const item = await this.inventoryRepo.findOne({ where: { id: inventoryItemId } });
    if (!item) return;

    if (item.quantity <= 0) {
      await this.repo.createQueryBuilder()
        .update()
        .set({ status: 'sold_out', updatedAt: new Date() } as any)
        .where('"inventoryItemId" = :id AND status = :s', { id: inventoryItemId, s: 'active' })
        .execute();
    } else {
      // Clamp listing quantity to available inventory without a TypeScript loop
      await this.dataSource.query(`
        UPDATE p2p_listings
        SET quantity = LEAST(quantity, $1), "updatedAt" = now()
        WHERE "inventoryItemId" = $2 AND status = 'active'
      `, [item.quantity, inventoryItemId]);
    }
  }

  // ── Auto-discount cron ────────────────────────────────────────────────────

  @Cron('15 3 * * *')
  async applyAutoDiscounts(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const d30 = new Date(today.getTime() + 30 * 86_400_000);
    const d60 = new Date(today.getTime() + 60 * 86_400_000);
    const d90 = new Date(today.getTime() + 90 * 86_400_000);

    // Expire overdue listings
    const [, expired] = await this.dataSource.query<[never[], number]>(`
      UPDATE p2p_listings
      SET status = 'expired', "updatedAt" = now()
      WHERE status = 'active'
        AND "autoUpdateDiscount" = true
        AND "expiryDate" IS NOT NULL
        AND "expiryDate" <= $1
    `, [today]);

    // ≤30 days → 15% off, clearance
    const [, tier30] = await this.dataSource.query<[never[], number]>(`
      UPDATE p2p_listings
      SET "discountPct" = 15, "listingType" = 'clearance', "updatedAt" = now()
      WHERE status = 'active'
        AND "autoUpdateDiscount" = true
        AND "expiryDate" IS NOT NULL
        AND "expiryDate" > $1
        AND "expiryDate" <= $2
    `, [today, d30]);

    // ≤60 days → 10% off
    const [, tier60] = await this.dataSource.query<[never[], number]>(`
      UPDATE p2p_listings
      SET "discountPct" = 10, "listingType" = 'clearance', "updatedAt" = now()
      WHERE status = 'active'
        AND "autoUpdateDiscount" = true
        AND "expiryDate" IS NOT NULL
        AND "expiryDate" > $1
        AND "expiryDate" <= $2
    `, [d30, d60]);

    // ≤90 days → 5% off
    const [, tier90] = await this.dataSource.query<[never[], number]>(`
      UPDATE p2p_listings
      SET "discountPct" = 5, "listingType" = 'clearance', "updatedAt" = now()
      WHERE status = 'active'
        AND "autoUpdateDiscount" = true
        AND "expiryDate" IS NOT NULL
        AND "expiryDate" > $1
        AND "expiryDate" <= $2
    `, [d60, d90]);

    this.logger.log(
      `Auto-discount cron: expired=${expired ?? 0}, ≤30d=${tier30 ?? 0}, ≤60d=${tier60 ?? 0}, ≤90d=${tier90 ?? 0}`,
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getOwnOrThrow(
    sellerTenantId: string,
    listingId: string,
  ): Promise<P2pListing> {
    const listing = await this.repo.findOne({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerTenantId !== sellerTenantId)
      throw new ForbiddenException('Not your listing');
    return listing;
  }

  private async buildRuleInput(
    sellerTenantId: string,
    dto: CreateListingDto,
    excludeListingId?: string,
  ): Promise<{
    item: InventoryItem;
    input: Parameters<typeof ListingRulesEngine.evaluate>[0];
  }> {
    const item = await this.inventoryRepo.findOne({ where: { id: dto.inventoryItemId } });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (item.pharmacyTenantId !== sellerTenantId)
      throw new ForbiddenException('Inventory item does not belong to your pharmacy');

    const duplicateQuery = this.repo
      .createQueryBuilder('l')
      .where('l.inventoryItemId = :id', { id: dto.inventoryItemId })
      .andWhere('l.status = :status', { status: 'active' })
      .andWhere('l.sellerTenantId = :tenant', { tenant: sellerTenantId });

    if (excludeListingId) {
      duplicateQuery.andWhere('l.id != :excludeId', { excludeId: excludeListingId });
    }

    const hasActiveDuplicate = (await duplicateQuery.getCount()) > 0;

    return {
      item,
      input: {
        linkStatus: item.linkStatus,
        expiryDate: dto.expiryDate ?? item.expiryDate,
        quantity: dto.quantity,
        minOrderQty: dto.minOrderQty ?? 1,
        price: dto.price,
        costPrice: item.costPrice ? Number(item.costPrice) : null,
        hasActiveDuplicate,
      },
    };
  }

  private suggestListingType(
    expiryDate?: string,
    quantity?: number,
  ): 'normal' | 'clearance' | 'emergency' {
    if (expiryDate) {
      const daysLeft = Math.floor(
        (new Date(expiryDate).getTime() - Date.now()) / 86_400_000,
      );
      if (daysLeft <= 90) return 'clearance';
    }
    if (quantity != null && quantity <= 5) return 'emergency';
    return 'normal';
  }
}

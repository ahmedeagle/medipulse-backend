import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { P2pListing } from '../p2p-listing/entities/p2p-listing.entity';

export interface ExpiryAlert {
  inventoryItemId: string;
  productId: string;
  productName?: string;
  productNameAr?: string;
  productCode?: string;
  quantity: number;
  expiryDate: Date;
  daysLeft: number;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  suggestedAction: 'list_clearance' | 'increase_discount' | 'list_normal';
  suggestedDiscountPct: number;
  alreadyListed: boolean;
  existingListingId?: string;
}

@Injectable()
export class ExpiryProtectionService {
  private readonly logger = new Logger(ExpiryProtectionService.name);

  constructor(
    @InjectRepository(InventoryItem)
    private readonly invRepo: Repository<InventoryItem>,
    @InjectRepository(P2pListing)
    private readonly listingRepo: Repository<P2pListing>,
  ) {}

  async getAlertsForSeller(pharmacyTenantId: string): Promise<ExpiryAlert[]> {
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 180);

    // Items expiring within 180 days, still in stock, not deleted — join product for names
    // Use DATE(NOW()) so items expiring today are included (avoids timezone cutoff at midnight)
    const todayDate = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const horizonDate = horizon.toISOString().slice(0, 10); // 'YYYY-MM-DD' — must match todayDate format
    const items = await this.invRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.product', 'product')
      .where('inv."pharmacyTenantId" = :tenantId', { tenantId: pharmacyTenantId })
      .andWhere('inv."expiryDate" IS NOT NULL')
      .andWhere('inv."expiryDate" >= :today', { today: todayDate })
      .andWhere('inv."expiryDate" <= :horizon', { horizon: horizonDate })
      .andWhere('inv.quantity > 0')
      .andWhere('inv."deletedAt" IS NULL')
      .orderBy('inv."expiryDate"', 'ASC')
      .take(100)
      .getMany();

    if (items.length === 0) return [];

    // Check which items already have an active or paused listing.
    // Match by inventoryItemId when the listing was created from an inventory lot,
    // OR by productId when the listing was created by product name (inventoryItemId is null).
    const itemIds = items.map((i) => i.id);
    const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
    const existingListings = await this.listingRepo
      .createQueryBuilder('l')
      .where('l."sellerTenantId" = :tenantId', { tenantId: pharmacyTenantId })
      .andWhere("l.status IN ('active', 'paused')")
      .andWhere(
        '(l."inventoryItemId" IN (:...itemIds) OR l."productId" IN (:...productIds))',
        { itemIds, productIds: productIds.length ? productIds : ['__none__'] },
      )
      .select(['l.id', 'l."inventoryItemId"', 'l."productId"', 'l."discountPct"'])
      .getMany();

    const listingByItemId = new Map(existingListings.map((l) => [l.inventoryItemId, l]));
    const listingByProductId = new Map(existingListings.map((l) => [l.productId, l]));

    return items.map((item) => {
      const daysLeft = Math.max(
        0,
        Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86_400_000),
      );
      const existing = listingByItemId.get(item.id) ?? listingByProductId.get(item.productId);

      let urgency: ExpiryAlert['urgency'];
      let suggestedAction: ExpiryAlert['suggestedAction'];
      let suggestedDiscountPct: number;

      if (daysLeft <= 30) {
        urgency = 'critical';
        suggestedAction = existing ? 'increase_discount' : 'list_clearance';
        suggestedDiscountPct = 20;
      } else if (daysLeft <= 60) {
        urgency = 'high';
        suggestedAction = existing ? 'increase_discount' : 'list_clearance';
        suggestedDiscountPct = 15;
      } else if (daysLeft <= 90) {
        urgency = 'medium';
        suggestedAction = 'list_clearance';
        suggestedDiscountPct = 10;
      } else {
        urgency = 'low';
        suggestedAction = 'list_normal';
        suggestedDiscountPct = 5;
      }

      return {
        inventoryItemId: item.id,
        productId: item.productId,
        productName:   (item as any).product?.name,
        productNameAr: (item as any).product?.nameAr,
        productCode:   (item as any).product?.sku || (item as any).product?.barcode,
        quantity: item.quantity,
        expiryDate: item.expiryDate,
        daysLeft,
        urgency,
        suggestedAction,
        suggestedDiscountPct,
        alreadyListed: !!existing,
        existingListingId: existing?.id,
      };
    });
  }
}

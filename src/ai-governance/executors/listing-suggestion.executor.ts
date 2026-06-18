import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { Approval } from '../entities/approval.entity';
import { ApprovalService } from '../approval.service';

interface ListingSuggestionPayload {
  inventoryItemId: string;
  productId: string;
  quantity: number;
  expiryDate?: string;
  suggestedListingType?: 'clearance' | 'emergency' | 'normal';
  suggestedDiscountPct?: number;
  /** User-overridden price; if absent, calculated from costPrice + discount */
  price?: number;
}

@Injectable()
export class ListingSuggestionExecutor {
  private readonly logger = new Logger(ListingSuggestionExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'p2p_listing_suggestion') return;

    const payload = (approval.payload ?? {}) as ListingSuggestionPayload;

    try {
      const invRepo     = this.dataSource.getRepository('inventory_items');
      const listingRepo = this.dataSource.getRepository('p2p_listings');

      const item = await invRepo.findOne({ where: { id: payload.inventoryItemId } }) as any;
      if (!item) throw new Error(`Inventory item ${payload.inventoryItemId} not found`);

      const discountPct   = payload.suggestedDiscountPct ?? 10;
      const costPrice     = Number(item.costPrice ?? 0);
      const listingPrice  = payload.price ??
        (costPrice > 0 ? parseFloat((costPrice * (1 - discountPct / 100)).toFixed(2)) : 0);

      // Check for duplicate active listing for this inventory item
      const existing = await listingRepo.findOne({
        where: { inventoryItemId: payload.inventoryItemId, status: 'active' },
      });
      if (existing) throw new Error('Active listing already exists for this item — pausing the existing one first');

      const listing = listingRepo.create({
        sellerTenantId:     approval.tenantId,
        inventoryItemId:    payload.inventoryItemId,
        productId:          payload.productId,
        price:              listingPrice,
        quantity:           payload.quantity,
        minOrderQty:        1,
        expiryDate:         payload.expiryDate ? new Date(payload.expiryDate) : null,
        listingType:        payload.suggestedListingType ?? 'clearance',
        offerType:          discountPct > 0 ? 'discount' : 'none',
        discountPct:        discountPct > 0 ? discountPct : null,
        autoUpdateDiscount: true,
        status:             'active',
      });
      const saved = await listingRepo.save(listing) as any;

      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        listingId:  saved.id,
        executedAt: new Date().toISOString(),
        price:      listingPrice,
      });
      this.logger.log(`ListingSuggestion ${approval.id} → P2P listing ${saved.id}`);
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`ListingSuggestion ${approval.id} failed: ${reason}`);
      try {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          error:      reason,
          executedAt: new Date().toISOString(),
          failed:     true,
        });
      } catch { /* state machine race */ }
    }
  }
}

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { ApprovalService } from '../ai-governance/approval.service';
import { Approval } from '../ai-governance/entities/approval.entity';
import { ProcurementDraft } from './entities/procurement-draft.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderStatus } from '../common/enums/order-status.enum';

interface BasketLine {
  draftId:     string;
  productId:   string;
  productName: string;
  quantity:    number;
  unitPrice:   number;
  lineTotal:   number;
}

interface BasketPayload {
  kind:         'supplier_basket';
  supplierId:   string;
  supplierName: string;
  currency:     string;
  items:        BasketLine[];
  draftIds:     string[];
  subtotal:     number;
  totalVat:     number;
}

/**
 * Executes supplier-basket approvals (subjectType=`procurement_basket`).
 *
 * Why this exists separately from PurchaseApprovalExecutor:
 *   - Basket approvals carry N line items, not one.
 *   - The natural execution is ONE Order with N OrderItems — a real
 *     multi-product PO from a single supplier. That matches how the
 *     pharmacist actually places orders in the real world (one shipment,
 *     one invoice) and is what makes the bundling worthwhile.
 *   - Everything must succeed atomically: partial baskets would leave
 *     half-converted drafts and a confusing audit trail.
 *
 * Failure handling mirrors PurchaseApprovalExecutor: the approval is marked
 * executed-with-failure (so it disappears from the pending queue) and each
 * draft is rejected with the reason. The 5-minute bridge will not re-pick
 * rejected drafts.
 */
@Injectable()
export class PurchaseBasketExecutor {
  private readonly logger = new Logger(PurchaseBasketExecutor.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly dataSource: DataSource,
    @InjectRepository(ProcurementDraft)
    private readonly draftRepo: Repository<ProcurementDraft>,
    @InjectRepository(SupplierCatalogItem)
    private readonly catalogRepo: Repository<SupplierCatalogItem>,
  ) {}

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'procurement_basket') return;
    const payload = (approval.payload ?? {}) as Partial<BasketPayload>;
    if (payload.kind !== 'supplier_basket' || !payload.draftIds?.length) {
      this.logger.warn(`basket approval ${approval.id} has malformed payload`);
      return;
    }

    try {
      const orderId = await this.executeBasket(approval.tenantId, payload as BasketPayload);
      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        orderId,
        executedAt: new Date().toISOString(),
      });
      this.logger.log(`basket approval ${approval.id} executed → order ${orderId}`);
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`basket approval ${approval.id} failed: ${reason}`);

      // Reject every draft in the basket so the bridge won't recreate the
      // same failing approval on the next 5-minute scan. We do this in a
      // single bulk UPDATE — much cheaper than N round-trips.
      try {
        await this.draftRepo.update(
          { id: In(payload.draftIds), status: 'pending_review' as any },
          {
            status:          'rejected' as any,
            rejectionReason: `Basket execution failed: ${reason}`,
          },
        );
      } catch (rejectErr) {
        this.logger.warn(
          `couldn't reject basket drafts after failure: ${(rejectErr as Error).message}`,
        );
      }

      try {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          error:      reason,
          executedAt: new Date().toISOString(),
          failed:     true,
        });
      } catch { /* state-machine race — ignore */ }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Builds ONE multi-line Order from a supplier basket inside a single DB
   * transaction. Re-verifies supplier listings at execution time — a basket
   * may have aged before the human clicked approve and stock can drift.
   */
  private async executeBasket(tenantId: string, payload: BasketPayload): Promise<string> {
    // 1) Load the live drafts that are still pending (defensive: skip any
    //    that someone manually rejected between approval and execution).
    const drafts = await this.draftRepo.find({
      where: {
        id:               In(payload.draftIds),
        pharmacyTenantId: tenantId,
        status:           'pending_review' as any,
      },
    });
    if (drafts.length === 0) {
      throw new BadRequestException('No pending drafts in this basket — already actioned');
    }

    // 2) Re-verify each supplier listing is still available with enough
    //    stock. We do not silently drop lines: if any line is unfulfillable
    //    the whole basket fails, so the pharmacist sees a clear reason and
    //    can re-trigger generation.
    const listings = await this.catalogRepo.find({
      where: {
        productId:        In(drafts.map(d => d.productId)),
        supplierTenantId: drafts[0].supplierTenantId,
        isAvailable:      true,
      },
    });
    const listingByProduct = new Map(listings.map(l => [l.productId, l]));
    for (const d of drafts) {
      const l = listingByProduct.get(d.productId);
      if (!l) {
        throw new BadRequestException(
          `Supplier no longer carries product ${d.productId} — reject this basket and regenerate.`,
        );
      }
      if (Number(l.stock ?? 0) > 0 && Number(l.stock) < d.suggestedQuantity) {
        throw new BadRequestException(
          `Insufficient stock for product ${d.productId}: available ${l.stock}, requested ${d.suggestedQuantity}.`,
        );
      }
    }

    // 3) Build one Order with N OrderItems atomically.
    const vatRate  = 0.15;
    let   subtotal = 0;
    const lines    = drafts.map(d => {
      const unitPrice  = Number(listingByProduct.get(d.productId)!.price);
      const lineTotal  = unitPrice * d.suggestedQuantity;
      subtotal        += lineTotal;
      return { draft: d, unitPrice, lineTotal };
    });
    const vatAmount   = Math.round(subtotal * vatRate * 100) / 100;
    const totalAmount = Math.round((subtotal + vatAmount) * 100) / 100;

    return this.dataSource.transaction(async (manager) => {
      const order = await manager.save(
        Order,
        manager.create(Order, {
          pharmacyTenantId:  tenantId,
          supplierTenantId:  drafts[0].supplierTenantId,
          currency:          payload.currency || 'SAR',
          subtotalAmount:    subtotal,
          vatRate,
          vatAmount,
          totalAmount,
          status:            OrderStatus.SUBMITTED,
          notes:             `Supplier basket: ${drafts.length} products from one supplier`,
        }),
      );

      for (const { draft, unitPrice, lineTotal } of lines) {
        await manager.save(
          OrderItem,
          manager.create(OrderItem, {
            orderId:    order.id,
            productId:  draft.productId,
            quantity:   draft.suggestedQuantity,
            unitPrice,
            totalPrice: lineTotal,
          }),
        );
      }

      await manager.update(
        ProcurementDraft,
        { id: In(drafts.map(d => d.id)) },
        { status: 'converted_to_order' as any, convertedOrderId: order.id },
      );

      return order.id;
    });
  }
}

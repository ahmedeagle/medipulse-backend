import { Injectable, BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { ProcurementDraft } from './entities/procurement-draft.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Product } from '../inventory/entities/product.entity';
import { OrderStatus } from '../common/enums/order-status.enum';

/**
 * Single canonical implementation of "draft → Order + OrderItem".
 *
 * Previously this logic was duplicated in two places:
 *   - ProcurementDraftService.approveDraft   (single-draft approval)
 *   - ProcurementCartService.checkoutCart    (cart split execution)
 *
 * Both call sites now go through {@link buildOrderFromDraft} so that any
 * future change to pricing, VAT, currency, or notes only needs to happen
 * in one place. The builder is intentionally side-effect-free w.r.t. the
 * draft row itself — the caller is responsible for marking the draft as
 * `converted_to_order` so each lifecycle owner retains full control of
 * its own state transitions.
 */
export interface BuildOrderOptions {
  /** Resolved unit price to charge. Callers verify supplier availability first. */
  unitPrice: number;
  /** ISO currency code, defaults vary by lifecycle (KSA legacy = SAR, cart = EGP). */
  currency: string;
  /** Decimal VAT rate (0.15 = 15%). Caller supplies based on tenant tax settings. */
  vatRate: number;
  /** Free-form note recorded on the order for traceability. */
  notes: string;
}

@Injectable()
export class ProcurementOrderBuilder {
  /**
   * Persist a new Order + OrderItem from a draft inside the caller's
   * transaction. Returns the saved order so callers can collect ids.
   */
  async buildOrderFromDraft(
    manager: EntityManager,
    draft: ProcurementDraft,
    tenantId: string,
    opts: BuildOrderOptions,
  ): Promise<Order> {
    // Controlled-substance guard: narcotics/psychotropics (Saudi MOH / EG UPFC
    // schedules) require a licensed pharmacist's explicit sign-off on every
    // order. The smart-plan / cart / auto-approval paths have no per-item
    // acknowledgement UI, so we hard-block them here and force the pharmacist
    // to place the order through the manual flow (POST /orders with
    // pharmacistAcknowledged: true). This mirrors the check in OrdersService.
    const product = await manager.findOne(Product, { where: { id: draft.productId } });
    if (product?.controlledSubstanceSchedule != null) {
      throw new BadRequestException(
        `“${product.name}” دواء مجدول (Schedule ${product.controlledSubstanceSchedule}) — ` +
        `يجب طلبه يدوياً بتوقيع الصيدلي المسؤول ولا يمكن شراؤه عبر الخطة الذكية.`,
      );
    }

    const subtotal  = this.money(opts.unitPrice * draft.suggestedQuantity);
    const vatAmount = this.money(subtotal * opts.vatRate);
    const total     = this.money(subtotal + vatAmount);

    const order = manager.create(Order, {
      pharmacyTenantId:  tenantId,
      supplierTenantId:  draft.supplierTenantId,
      currency:          opts.currency,
      subtotalAmount:    subtotal,
      vatRate:           opts.vatRate,
      vatAmount,
      totalAmount:       total,
      status:            OrderStatus.SUBMITTED,
      notes:             opts.notes,
    });
    const savedOrder = await manager.save(Order, order);

    await manager.save(
      OrderItem,
      manager.create(OrderItem, {
        orderId:    savedOrder.id,
        productId:  draft.productId,
        quantity:   draft.suggestedQuantity,
        unitPrice:  opts.unitPrice,
        totalPrice: total,
      }),
    );

    return savedOrder;
  }

  /** Two-decimal money helper with NaN/negative guard. */
  private money(n: number): number {
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }
}

import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ProcurementDraft } from './entities/procurement-draft.entity';
import { ProcurementOrchestrator } from './procurement-orchestrator.service';
import { ProcurementOrderBuilder } from './procurement-order.builder';
import { OrchestratorResult, PlanSplit } from './procurement-orchestrator.types';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderStatus } from '../common/enums/order-status.enum';
import { P2P_EVENTS, EVENTS } from '../events/domain-events';
import { ApprovalService } from '../ai-governance/approval.service';
import { PharmacySettingsService, BillingContext } from '../pharmacy-settings/pharmacy-settings.service';

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Strip internal-only fields from the explainability payload before sending
 * it to the client. `rejectedOptions` is retained in the DB plan snapshot
 * for audit / compliance review, but exposing it to the pharmacist UI risks
 * (a) eroding trust in suppliers that were objectively passed over for
 * reasons unrelated to their quality, and (b) creating commercial friction
 * with named suppliers. The user-facing card only needs the *positive*
 * `selectedPlanReason`.
 */
function sanitiseExplainabilityForClient(
  ex: Record<string, any> | null | undefined,
): Record<string, unknown> {
  if (!ex || typeof ex !== 'object') return {};
  const { rejectedOptions: _omit, ...safe } = ex as Record<string, unknown>;
  return safe;
}

export interface CartItem {
  draftId: string;
  productId: string;
  productName?: string;
  source: 'p2p' | 'supplier';
  sourceName: string;
  qty: number;
  unitPrice: number;
  totalCost: number;
  riskScore: number;
  confidence: number;
  stale: boolean;
  freshAt: Date | null;
  explainability: Record<string, unknown>;
  // Surfaced from the cached OrchestratorResult so the cart drawer can
  // render the finance bar + delay counter-recommendation without
  // re-running the orchestrator on every page open.
  financialStatus?: Record<string, unknown> | null;
  delayRecommendation?: Record<string, unknown> | null;
  overpaymentRecommendation?: Record<string, unknown> | null;
}

export interface CartSummary {
  items: CartItem[];
  totalCost: number;
  hasStaleItems: boolean;
  productCount: number;
}

export interface CheckoutResult {
  supplierOrderIds: string[];
  p2pOrderIds: string[];
  checkedOutDraftIds: string[];
}

@Injectable()
export class ProcurementCartService {
  private readonly logger = new Logger(ProcurementCartService.name);

  constructor(
    @InjectRepository(ProcurementDraft)
    private readonly draftRepo: Repository<ProcurementDraft>,
    private readonly orchestrator: ProcurementOrchestrator,
    private readonly orderBuilder: ProcurementOrderBuilder,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly approvalService: ApprovalService,
    private readonly pharmacySettings: PharmacySettingsService,
  ) {}

  // ─── ADD TO CART ─────────────────────────────────────────────────────────────

  /**
   * Runs the Procurement Decision Engine for the requested product + qty,
   * then persists one ProcurementDraft per split (P2P or supplier).
   * Removes any existing pending ai_plan drafts for the same product (deduplication).
   */
  async addToCart(tenantId: string, productId: string, qty: number): Promise<OrchestratorResult> {
    const plan = await this.orchestrator.generatePlan(tenantId, productId, qty, {
      triggerEvent: 'cart_add',
    });

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const freshAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      // Remove stale ai_plan drafts for same product (replace with fresh plan)
      await manager.delete(ProcurementDraft, {
        pharmacyTenantId: tenantId,
        productId,
        sourceType: 'ai_plan',
        status: 'pending_review',
      });

      // Create one draft per split
      for (const split of plan.splits) {
        const draft = manager.create(ProcurementDraft, {
          pharmacyTenantId: tenantId,
          supplierTenantId: split.source === 'supplier' ? split.sourceId : null,
          productId,
          suggestedQuantity: split.qty,
          unitPrice: split.unitPrice,
          currency: 'EGP',
          urgencyLevel: this.riskToUrgency(plan.riskScore),
          status: 'pending_review',
          sourceType: 'ai_plan',
          splitSource: split.source,
          p2pListingId: split.source === 'p2p' ? split.sourceId : null,
          planSnapshot: plan as unknown as Record<string, unknown>,
          signalFreshnessAt: freshAt,
          expiresAt,
        });
        await manager.save(ProcurementDraft, draft);
      }
    });

    this.logger.log(
      `Cart add: tenant=${tenantId} product=${productId} qty=${qty} → ${plan.splits.length} splits`,
    );
    return plan;
  }

  // ─── GET CART ────────────────────────────────────────────────────────────────

  /**
   * Returns all pending AI-plan drafts for the tenant, with staleness flag.
   * Lightweight: single query + in-memory grouping, no N+1.
   */
  async getCart(tenantId: string): Promise<CartSummary> {
    // Single optimised query — uses idx_drafts_cart index
    const drafts = await this.draftRepo.find({
      select: [
        'id', 'productId', 'splitSource', 'p2pListingId', 'supplierTenantId',
        'suggestedQuantity', 'unitPrice', 'signalFreshnessAt', 'planSnapshot', 'expiresAt',
      ],
      where: {
        pharmacyTenantId: tenantId,
        sourceType: 'ai_plan',
        status: 'pending_review',
      },
      order: { createdAt: 'ASC' } as any,
    });

    const now = Date.now();
    const items: CartItem[] = drafts.map((d) => {
      const snapshot = d.planSnapshot as any;
      const stale =
        !d.signalFreshnessAt ||
        now - d.signalFreshnessAt.getTime() > STALE_THRESHOLD_MS;

      // Find the matching split from snapshot for rich display data
      const splitInSnapshot = snapshot?.splits?.find(
        (s: PlanSplit) =>
          s.source === d.splitSource && s.sourceId === (d.splitSource === 'p2p' ? d.p2pListingId : d.supplierTenantId),
      ) as PlanSplit | undefined;

      return {
        draftId: d.id,
        productId: d.productId,
        productName: (snapshot as any)?.productName,
        source: (d.splitSource ?? 'supplier') as 'p2p' | 'supplier',
        sourceName: splitInSnapshot?.sourceName ?? d.supplierTenantId ?? 'مورد',
        qty: d.suggestedQuantity,
        unitPrice: Number(d.unitPrice),
        totalCost: d.suggestedQuantity * Number(d.unitPrice),
        riskScore: snapshot?.riskScore ?? 0,
        confidence: snapshot?.confidence ?? 0,
        stale,
        freshAt: d.signalFreshnessAt,
        // Strip rejectedOptions before sending to UI — naming a "rejected"
        // supplier in the user-facing payload can damage supplier
        // relationships. The full list is still retained in DB (planSnapshot)
        // for audit and internal review.
        explainability: sanitiseExplainabilityForClient(snapshot?.explainability),
        financialStatus: snapshot?.financialStatus ?? null,
        delayRecommendation: snapshot?.delayRecommendation ?? null,
        overpaymentRecommendation: snapshot?.overpaymentRecommendation ?? null,
      };
    });

    const totalCost = items.reduce((sum, i) => sum + i.totalCost, 0);
    const productIds = new Set(items.map((i) => i.productId));

    return {
      items,
      totalCost,
      hasStaleItems: items.some((i) => i.stale),
      productCount: productIds.size,
    };
  }

  // ─── RECOMPUTE STALE CART ────────────────────────────────────────────────────

  /**
   * Re-runs the orchestrator for all products with stale drafts.
   * Groups by productId to avoid running the orchestrator multiple times
   * for the same product (when there are multiple splits).
   */
  async recomputeCart(tenantId: string): Promise<{ recomputedProducts: number; changes: Array<{ productId: string; oldCost: number; newCost: number; riskDelta: number }> }> {
    const cart = await this.getCart(tenantId);
    const staleProductIds = [
      ...new Set(cart.items.filter((i) => i.stale).map((i) => i.productId)),
    ];

    const changes: Array<{ productId: string; oldCost: number; newCost: number; riskDelta: number }> = [];

    for (const productId of staleProductIds) {
      const oldItems = cart.items.filter((i) => i.productId === productId);
      const totalQty = oldItems.reduce((s, i) => s + i.qty, 0);
      const oldCost = oldItems.reduce((s, i) => s + i.totalCost, 0);
      const oldRisk = oldItems[0]?.riskScore ?? 0;

      const newPlan = await this.addToCart(tenantId, productId, totalQty);
      const newCost = newPlan.splits.reduce((s, sp) => s + sp.qty * sp.unitPrice, 0);

      changes.push({
        productId,
        oldCost,
        newCost,
        riskDelta: newPlan.riskScore - oldRisk,
      });
    }

    return { recomputedProducts: staleProductIds.length, changes };
  }

  // ─── APPLY SIMULATION PLAN ───────────────────────────────────────────────────

  /**
   * Replaces all pending ai_plan drafts for the product with splits from
   * a pre-computed OrchestratorResult (e.g. from the simulation endpoint).
   * Same persistence logic as addToCart but skips the orchestrator call.
   */
  async applyPlan(tenantId: string, plan: OrchestratorResult): Promise<CartSummary> {
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const freshAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ProcurementDraft, {
        pharmacyTenantId: tenantId,
        productId: plan.productId,
        sourceType: 'ai_plan',
        status: 'pending_review',
      });

      for (const split of plan.splits) {
        const draft = manager.create(ProcurementDraft, {
          pharmacyTenantId: tenantId,
          supplierTenantId: split.source === 'supplier' ? split.sourceId : null,
          productId: plan.productId,
          suggestedQuantity: split.qty,
          unitPrice: split.unitPrice,
          currency: 'EGP',
          urgencyLevel: this.riskToUrgency(plan.riskScore),
          status: 'pending_review',
          sourceType: 'ai_plan',
          splitSource: split.source,
          p2pListingId: split.source === 'p2p' ? split.sourceId : null,
          planSnapshot: plan as unknown as Record<string, unknown>,
          signalFreshnessAt: freshAt,
          expiresAt,
        });
        await manager.save(ProcurementDraft, draft);
      }
    });

    this.logger.log(
      `Cart apply-plan: tenant=${tenantId} product=${plan.productId} splits=${plan.splits.length}`,
    );
    return this.getCart(tenantId);
  }

  // ─── REMOVE CART ITEM ────────────────────────────────────────────────────────

  async removeCartItem(tenantId: string, draftId: string): Promise<void> {
    const draft = await this.draftRepo.findOne({
      where: { id: draftId, pharmacyTenantId: tenantId, sourceType: 'ai_plan' },
    });
    if (!draft) throw new NotFoundException('Cart item not found');
    if (draft.status !== 'pending_review') {
      throw new BadRequestException('Cannot remove an item that has already been processed');
    }
    await this.draftRepo.delete(draftId);
  }

  // ─── UPDATE CART ITEM ────────────────────────────────────────────────────────

  /**
   * Inline edit for a single cart line (PRD §11 — operator overrides).
   *
   * Allowed fields: qty, unitPrice. Supplier/source changes intentionally
   * route through addToCart so the orchestrator re-evaluates the whole
   * plan (a manual supplier swap without re-running the engine would
   * silently invalidate every signal in the explainability record).
   *
   * Any manual price edit clears `signalFreshnessAt` so the cart drawer
   * marks the line "stale" — this signals the user that the orchestrator
   * has not validated the new price against current market signals.
   */
  async updateCartItem(
    tenantId: string,
    draftId: string,
    patch: { qty?: number; unitPrice?: number },
  ): Promise<CartItem> {
    const draft = await this.draftRepo.findOne({
      where: { id: draftId, pharmacyTenantId: tenantId, sourceType: 'ai_plan' },
    });
    if (!draft) throw new NotFoundException('Cart item not found');
    if (draft.status !== 'pending_review') {
      throw new BadRequestException('Cannot edit an item that has already been processed');
    }

    const updates: Partial<ProcurementDraft> = {};
    if (patch.qty !== undefined) {
      if (!Number.isInteger(patch.qty) || patch.qty < 1) {
        throw new BadRequestException('qty must be a positive integer');
      }
      updates.suggestedQuantity = patch.qty;
    }
    if (patch.unitPrice !== undefined) {
      if (!Number.isFinite(patch.unitPrice) || patch.unitPrice < 0) {
        throw new BadRequestException('unitPrice must be a non-negative number');
      }
      updates.unitPrice = patch.unitPrice;
      // Manual price override invalidates orchestrator confidence —
      // mark the line stale so the user is prompted to recompute.
      updates.signalFreshnessAt = null;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No editable fields supplied');
    }

    await this.draftRepo.update(draftId, updates);

    // Return the updated line in the same shape the cart drawer renders
    // so the client can patch its query cache without a full refetch.
    const cart = await this.getCart(tenantId);
    const updated = cart.items.find((i) => i.draftId === draftId);
    if (!updated) throw new NotFoundException('Cart item not found after update');
    return updated;
  }

  // ─── CHECKOUT ────────────────────────────────────────────────────────────────

  /**
   * Atomically executes all pending cart drafts:
   *  - Supplier splits → creates a real Order + OrderItem (existing approveDraft logic)
   *  - P2P splits → creates a p2p_order record
   *
   * All-or-nothing: if any split fails, the transaction rolls back.
   */
  async checkoutCart(tenantId: string): Promise<CheckoutResult> {
    // Initial unlocked read — just to see if there is anything to do and to
    // capture the set of approval IDs we'll need to clean up after commit.
    // The authoritative claim happens inside the transaction via FOR UPDATE.
    const initialDrafts = await this.draftRepo.find({
      where: {
        pharmacyTenantId: tenantId,
        sourceType: 'ai_plan',
        status: 'pending_review',
      },
      select: ['id', 'basketApprovalId'],
    });

    if (initialDrafts.length === 0) {
      throw new BadRequestException('عربة الشراء فارغة — أضف منتجات أولاً');
    }

    // Resolve currency + VAT from tenant settings once for this checkout
    // (jurisdiction-aware: EG 14%, KSA 15%, UAE/Oman 5%, …).
    const billing = await this.pharmacySettings.getBillingContext(tenantId);

    const supplierOrderIds: string[] = [];
    const p2pOrderIds: string[] = [];
    const checkedOutDraftIds: string[] = [];
    // Supplier orders we must announce to suppliers AFTER commit. Emitting
    // order.submitted is what triggers the supplier "New Order Received"
    // notification + email — exactly like the manual POST /orders path.
    const supplierOrdersToNotify: Array<{ orderId: string; supplierTenantId: string }> = [];
    // Map: approvalId → first orderId we created from a draft linked to it.
    // After commit we mark these approvals 'executed' so the AI Center stops
    // showing them — the cart is the source of truth for what was shipped.
    const approvalToOrder = new Map<string, string>();

    await this.dataSource.transaction(async (manager) => {
      // Atomic claim: lock every candidate draft row in one shot, then
      // re-verify each is still 'pending_review'. Any draft that another
      // transaction (e.g. AI-Center approve click, basket executor) has
      // already converted will be skipped — we do not silently drop, we
      // throw so the user sees a clear conflict and can refresh.
      const lockedDrafts = await manager.find(ProcurementDraft, {
        where: { id: In(initialDrafts.map(d => d.id)) },
        lock: { mode: 'pessimistic_write' },
      });
      const stillEligible = lockedDrafts.filter(d => d.status === 'pending_review');
      if (stillEligible.length === 0) {
        throw new ConflictException(
          'جميع منتجات العربة تمت معالجتها بالفعل من مركز الذكاء — حدِّث الصفحة',
        );
      }
      if (stillEligible.length !== lockedDrafts.length) {
        const skipped = lockedDrafts.length - stillEligible.length;
        throw new ConflictException(
          `${skipped} من عناصر العربة تمت معالجتها في مكان آخر — أعد تحميل العربة وحاول مجدداً`,
        );
      }

      for (const draft of stillEligible) {
        if (draft.splitSource === 'p2p' && draft.p2pListingId) {
          const orderId = await this.executeP2PSplit(manager, draft, tenantId);
          p2pOrderIds.push(orderId);
          if (draft.basketApprovalId && !approvalToOrder.has(draft.basketApprovalId)) {
            approvalToOrder.set(draft.basketApprovalId, orderId);
          }
        } else {
          const orderId = await this.executeSupplierSplit(manager, draft, tenantId, billing);
          supplierOrderIds.push(orderId);
          supplierOrdersToNotify.push({ orderId, supplierTenantId: draft.supplierTenantId });
          if (draft.basketApprovalId && !approvalToOrder.has(draft.basketApprovalId)) {
            approvalToOrder.set(draft.basketApprovalId, orderId);
          }
        }
        checkedOutDraftIds.push(draft.id);
      }

      // Mark all drafts as converted. We use the SAME locked set so a
      // concurrent writer can't slip in between the loop and this update.
      await manager.update(ProcurementDraft, { id: In(checkedOutDraftIds) }, {
        status: 'converted_to_order',
      });
    });

    // Post-commit: announce every supplier order so the supplier gets the
    // "New Order Received" notification + email. Done OUTSIDE the txn so a
    // listener throwing can never roll back already-committed orders.
    for (const o of supplierOrdersToNotify) {
      try {
        this.eventEmitter.emit(EVENTS.ORDER_SUBMITTED, {
          orderId: o.orderId,
          pharmacyTenantId: tenantId,
          supplierTenantId: o.supplierTenantId,
        });
      } catch (err) {
        this.logger.warn(
          `cart-checkout: couldn't emit order.submitted for ${o.orderId}: ${(err as Error).message}`,
        );
      }
    }

    // Post-commit: settle any AI-Center approvals that pointed at these
    // drafts. We do this OUTSIDE the txn because approval.markExecuted
    // emits events (and we don't want to roll back the orders if a
    // listener throws). Errors here are logged but non-fatal — the orders
    // are already real; an orphan approval is a UI annoyance, not a money
    // leak. The basket executor itself short-circuits when subjectType is
    // procurement_basket because all its drafts are already 'converted',
    // so even if we miss this cleanup the system is internally consistent.
    for (const [approvalId, orderId] of approvalToOrder) {
      try {
        await this.approvalService.markExecuted(tenantId, approvalId, {
          orderId,
          executedAt: new Date().toISOString(),
          source: 'cart_checkout',
        });
      } catch (err) {
        this.logger.warn(
          `cart-checkout: couldn't settle linked approval ${approvalId}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Cart checkout: tenant=${tenantId} supplier_orders=${supplierOrderIds.length} p2p_orders=${p2pOrderIds.length} settled_approvals=${approvalToOrder.size}`,
    );
    return { supplierOrderIds, p2pOrderIds, checkedOutDraftIds };
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

  private async executeSupplierSplit(
    manager: any,
    draft: ProcurementDraft,
    tenantId: string,
    billing: BillingContext,
  ): Promise<string> {
    const order = await this.orderBuilder.buildOrderFromDraft(manager, draft, tenantId, {
      unitPrice: Number(draft.unitPrice),
      // Currency + VAT now come from the tenant's pharmacy settings
      // (jurisdiction-aware) instead of being hardcoded to EGP/15%.
      currency:  billing.currency,
      vatRate:   billing.vatRate,
      notes:     `خطة شراء ذكية — split من ${draft.id}`,
    });
    return order.id as string;
  }

  private async executeP2PSplit(
    manager: any,
    draft: ProcurementDraft,
    tenantId: string,
  ): Promise<string> {
    const listingRepo = this.dataSource.getRepository('p2p_listings');
    const listing = await listingRepo.findOne({ where: { id: draft.p2pListingId } }) as any;

    if (!listing) throw new BadRequestException(`إعلان P2P ${draft.p2pListingId} لم يعد متاحاً`);
    if (listing.status !== 'active') throw new BadRequestException('إعلان P2P لم يعد نشطاً');
    if (listing.quantity < draft.suggestedQuantity) {
      throw new BadRequestException(
        `الكمية المتاحة في P2P (${listing.quantity}) أقل من المطلوبة (${draft.suggestedQuantity})`,
      );
    }

    const priceDrift =
      Math.abs(Number(listing.price) - Number(draft.unitPrice)) / Number(draft.unitPrice);
    if (priceDrift > 0.05) {
      throw new BadRequestException(
        `سعر P2P تغير بنسبة ${(priceDrift * 100).toFixed(1)}% — أعد احتساب خطة الشراء أولاً`,
      );
    }

    const orderRepo = this.dataSource.getRepository('p2p_orders');
    const order = orderRepo.create({
      buyerTenantId: tenantId,
      sellerTenantId: listing.sellerTenantId,
      listingId: draft.p2pListingId,
      requestedQty: draft.suggestedQuantity,
      agreedPrice: listing.price,
      notes: 'طلب من خطة الشراء الذكي — مركز الذكاء',
      status: 'pending',
    });
    const savedOrder = await orderRepo.save(order) as any;

    this.eventEmitter.emit(P2P_EVENTS.ORDER_CREATED, {
      orderId: savedOrder.id,
      sellerTenantId: listing.sellerTenantId,
      buyerTenantId: tenantId,
    });

    return savedOrder.id as string;
  }

  private riskToUrgency(riskScore: number): 'critical' | 'high' | 'medium' {
    if (riskScore >= 70) return 'critical';
    if (riskScore >= 40) return 'high';
    return 'medium';
  }
}

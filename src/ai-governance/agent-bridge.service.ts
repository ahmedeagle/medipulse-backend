import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, DataSource } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ApprovalService } from './approval.service';
import { Approval } from './entities/approval.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { ProcurementDraft } from '../procurement/entities/procurement-draft.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Product } from '../inventory/entities/product.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { AiService } from '../ai/ai.service';
import { NotificationService } from '../notifications/notification.service';
import {
  EVENTS,
  RecommendationGeneratedEvent,
} from '../events/domain-events';
import { RecommendationType } from '../common/enums/recommendation-type.enum';

/**
 * AI-Workforce bridge — turns existing domain artefacts into approvals
 * required by PRD v2 §10–§12, *without* changing the existing producers.
 *
 * Creation paths (this file):
 *   1. `recommendation.generated` event ⇒ Inventory-Expert approval.
 *   2. Cron every 5 min ⇒ Purchase-Expert approval per pending draft.
 *   3. Cron every 5 min ⇒ Catalog-Expert approval per suggested item link.
 *
 * Execution path:
 *   ApprovalService emits `approval.approved`. Each domain module owns the
 *   listener for its own subjectType (procurement, inventory). Recommendations
 *   are advisory — handled here as acknowledgement only.
 */
@Injectable()
export class AgentBridgeService {
  private readonly logger = new Logger(AgentBridgeService.name);

  constructor(
    @InjectRepository(AiRecommendation) private readonly recRepo:    Repository<AiRecommendation>,
    @InjectRepository(ProcurementDraft) private readonly draftRepo:  Repository<ProcurementDraft>,
    @InjectRepository(InventoryItem)    private readonly itemRepo:   Repository<InventoryItem>,
    @InjectRepository(Product)          private readonly productRepo:Repository<Product>,
    @InjectRepository(Tenant)           private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Approval)         private readonly approvalRepo: Repository<Approval>,
    @InjectRepository(SupplierCatalogItem) private readonly catalogRepo: Repository<SupplierCatalogItem>,
    private readonly approvals: ApprovalService,
    private readonly aiService: AiService,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
  ) {}

  // ── 1) Inventory Expert: react to AI recommendations ────────────────────

  @OnEvent(EVENTS.RECOMMENDATION_GENERATED)
  async onRecommendationGenerated(ev: RecommendationGeneratedEvent): Promise<void> {
    const handledTypes = [
      RecommendationType.REORDER,
      RecommendationType.DEAD_STOCK_ALERT,
      RecommendationType.P2P_LISTING_SUGGESTION,
      RecommendationType.EXPIRED_QUARANTINE,
      RecommendationType.SMART_PROCUREMENT,
    ];
    if (!handledTypes.includes(ev.type as any)) return;
    try {
      const rec = await this.recRepo.findOne({
        where: { id: ev.recommendationId, pharmacyTenantId: ev.tenantId },
        relations: ['product'],
      });
      if (!rec) return;

      if (ev.type === RecommendationType.REORDER) {
        await this.ensureApprovalForRecommendation(rec);
      } else if (ev.type === RecommendationType.SMART_PROCUREMENT) {
        await this.ensureSmartProcurementApproval(rec);
      } else if (
        ev.type === RecommendationType.P2P_LISTING_SUGGESTION ||
        ev.type === RecommendationType.DEAD_STOCK_ALERT ||
        ev.type === RecommendationType.EXPIRED_QUARANTINE
      ) {
        await this.ensureRiskApprovalForRecommendation(rec);
      }
    } catch (err) {
      this.logger.error(`onRecommendationGenerated failed: ${(err as Error).message}`);
    }
  }

  private async ensureRiskApprovalForRecommendation(rec: AiRecommendation): Promise<void> {
    const exists = await this.approvalRepo.findOne({
      where: { tenantId: rec.pharmacyTenantId, subjectType: 'recommendation', subjectId: rec.id },
    });
    if (exists) return;

    const productName = rec.product?.nameAr || rec.product?.name || 'منتج';
    const priority = rec.riskLevel === 'HIGH' ? 'critical' : rec.riskLevel === 'MEDIUM' ? 'high' : 'medium';

    const isExpiry = rec.type === RecommendationType.P2P_LISTING_SUGGESTION;
    const daysLeft  = Number(rec.payload?.daysLeft ?? 0);
    const quantity  = Number(rec.payload?.quantity ?? 0);
    const discountPct = Number(rec.payload?.suggestedDiscountPct ?? 0);
    const deepLink  = rec.payload?.deepLink as string | undefined;

    const title = isExpiry
      ? `انتهاء قريب: ${productName} — ${daysLeft} يوم`
      : `مخزون راكد: ${productName}`;

    const summaryParts: string[] = [];
    if (isExpiry) {
      summaryParts.push(`الكمية: ${quantity} وحدة`);
      summaryParts.push(`تنتهي خلال ${daysLeft} يوم`);
      if (discountPct > 0) summaryParts.push(`خصم مقترح ${discountPct}%`);
      summaryParts.push('الإجراء: إدراج في البيع للصيدليات');
    } else {
      summaryParts.push(`الكمية: ${quantity || Number(rec.payload?.currentQuantity ?? 0)} وحدة`);
      summaryParts.push('لا توجد حركة بيع منذ أكثر من 60 يوماً');
      summaryParts.push('يُنصح بتصفية أو بيعه للصيدليات الأخرى');
    }

    await this.approvals.create(rec.pharmacyTenantId, {
      agentCode:        'inventory_expert',
      subjectType:      'recommendation',
      subjectId:        rec.id,
      // Both branches (expiry / dead-stock) describe the same business
      // need: liquidate this product. Collapse onto one card per product.
      needKey:          `liquidate::${rec.productId}`,
      title,
      summary:          summaryParts.join(' · '),
      rationale:        isExpiry
        ? `المنتج يقترب من تاريخ الانتهاء. البيع الآن بخصم ${discountPct}% أفضل من الخسارة الكاملة.`
        : 'لم يتحرك هذا المنتج في المخزون منذ فترة طويلة. قد يكون مرشحاً للتصفية أو البيع.',
      confidence:       0.85,
      priority:         priority as any,
      payload:          { ...rec.payload, deepLink, recType: rec.type },
      confidenceReason: isExpiry
        ? `مبنية على تاريخ الانتهاء الفعلي المسجل في المخزون وسياسة حماية القيمة.`
        : `مبنية على تحليل حركة المخزون خلال الفترة الأخيرة.`,
      expiresAt:        new Date(Date.now() + (isExpiry ? daysLeft * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000)).toISOString(),
    });
  }

  private async ensureApprovalForRecommendation(rec: AiRecommendation): Promise<void> {
    const exists = await this.approvalRepo.findOne({
      where: {
        tenantId:    rec.pharmacyTenantId,
        subjectType: 'recommendation',
        subjectId:   rec.id,
      },
    });
    if (exists) return;

    const productName = rec.product?.nameAr || rec.product?.name || 'منتج';
    const stock      = Number(rec.payload?.currentQuantity ?? rec.payload?.quantity ?? 0);
    const daily      = Number(rec.payload?.dailySalesRate ?? rec.payload?.dailySales ?? 0);
    const days       = Number(rec.payload?.stockDays ?? (daily > 0 ? stock / daily : 0));
    const reorderQty = Number(rec.payload?.suggestedReorderQty ?? rec.payload?.deficit ?? 0);

    const summaryParts: string[] = [`المتوفر الآن: ${stock} وحدة`];
    if (daily > 0)  summaryParts.push(`المتوسط اليومي: ${daily.toFixed(1)}`);
    if (days > 0)   summaryParts.push(`النفاد المتوقع خلال ${Math.max(1, Math.round(days))} يوم`);
    if (reorderQty) summaryParts.push(`الكمية المقترحة للشراء: ${reorderQty} وحدة`);

    const priority =
      rec.riskLevel === 'HIGH'   ? 'critical' :
      rec.riskLevel === 'MEDIUM' ? 'high'     : 'medium';

    await this.approvals.create(rec.pharmacyTenantId, {
      agentCode:       'inventory_expert',
      subjectType:     'recommendation',
      subjectId:       rec.id,
      // Restock need — collapses with low_stock / smart_procurement / draft.
      needKey:         `restock::${rec.productId}`,
      title:           `خطر نفاد المخزون: ${productName}`,
      summary:         summaryParts.join(' · '),
      rationale:       rec.explanation || 'تحليل اتجاه المبيعات لآخر 60 يوماً يشير إلى استنفاد قريب.',
      confidence:      Number(rec.confidence) || 0.7,
      priority:        priority as any,
      payload: {
        productId:           rec.productId,
        productName,
        currentQuantity:     stock,
        dailySalesRate:      daily,
        stockDays:           days,
        suggestedReorderQty: reorderQty,
        riskLevel:           rec.riskLevel,
        rulesTriggered:      rec.rulesTriggered ?? [],
      },
      confidenceReason: daily > 0
        ? `مبنية على ثبات نمط المبيعات لـ 60 يوماً (متوسط ${daily.toFixed(1)} وحدة يومياً) والمخزون الفعلي الحالي.`
        : `مبنية على المخزون الحالي وعتبة إعادة الطلب المحددة للمنتج.`,
      expiresAt:       new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
  }

  private async ensureSmartProcurementApproval(rec: AiRecommendation): Promise<void> {
    const exists = await this.approvalRepo.findOne({
      where: { tenantId: rec.pharmacyTenantId, subjectType: 'recommendation', subjectId: rec.id },
    });
    if (exists) return;

    const productName  = rec.product?.nameAr || rec.product?.name || 'منتج';
    const p2pPrice     = Number(rec.payload?.p2pPrice ?? 0);
    const suppPrice    = rec.payload?.supplierPrice ? Number(rec.payload.supplierPrice) : null;
    const savingsPct   = Number(rec.payload?.savingsPct ?? 0);
    const totalListings = Number(rec.payload?.totalListings ?? 1);
    const deepLink     = rec.payload?.deepLink as string | undefined;

    const priceNote    = suppPrice
      ? `سعر البورصة: ${p2pPrice.toFixed(2)} جنيه (توفير ${savingsPct}% مقارنةً بالمورد)`
      : `سعر البورصة: ${p2pPrice.toFixed(2)} جنيه`;

    await this.approvals.create(rec.pharmacyTenantId, {
      agentCode:        'inventory_expert',
      subjectType:      'recommendation',
      subjectId:        rec.id,
      // Same restock need as low_stock / draft — collapses to one card.
      needKey:          `restock::${rec.productId}`,
      title:            `شراء أسرع وأرخص: ${productName} متوفر في البورصة`,
      summary:          `${priceNote} — ${totalListings} عرض متاح. الكمية الناقصة: ${rec.payload?.deficit ?? '؟'} وحدة.`,
      rationale:        `مخزونك من ${productName} وصل للحد الأدنى. صيدلية أخرى تبيعه في البورصة الدوائية بسعر أفضل وبسرعة أكبر من الموردين التقليديين.${savingsPct > 0 ? ` ستوفر ${savingsPct}% مقارنةً بأرخص مورد متاح.` : ''}`,
      confidence:       0.80,
      priority:         rec.riskLevel === 'HIGH' ? 'critical' : 'high',
      payload:          { ...rec.payload, recType: rec.type, deepLink },
      confidenceReason: `مبنية على مقارنة مباشرة بين سعر البورصة الحالي وسعر أرخص مورد متاح لنفس المنتج.`,
      expiresAt:        new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
  }

  // ── 2) Purchase Expert: scan procurement drafts ─────────────────────────
  //
  // Two important filters here:
  //   • sourceType='manual'   → only auto-scheduler drafts flow through the
  //                             approval queue. Cart-add drafts
  //                             (sourceType='ai_plan') are managed by the
  //                             cart UI + checkout flow and must NOT create
  //                             duplicate approval cards on the Tasks tab.
  //   • basketApprovalId IS NULL → drafts already folded into a supplier
  //                             basket are skipped (idempotent scan).
  //
  // Drafts are then grouped per (tenant, supplier) so a single PO covers all
  // products the pharmacist needs from that supplier today — fewer clicks,
  // one shipment, one invoice.

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'purchase-expert-bridge' })
  async scanProcurementDrafts(): Promise<void> {
    // ORDER BY createdAt ASC ensures the oldest pending drafts get into the
    // queue first — so a flood of new drafts cannot starve out older ones.
    // NOTE: we intentionally do NOT filter by sourceType — both 'manual'
    // (legacy seed) and 'ai_plan' (Cart + auto-draft scheduler) need to
    // surface as Tasks. The (subjectId already-exists) check below de-dupes.
    const newDrafts = await this.draftRepo.find({
      where: {
        status:           'pending_review' as any,
        basketApprovalId: IsNull() as any,
      },
      order: { createdAt: 'ASC' },
      take: 200,
    });

    // ── Roll-up: also re-consider drafts that already have a single
    // `procurement_draft` approval still awaiting the pharmacist's decision.
    // If a brand-new draft arrives for the SAME supplier, we must merge them
    // into one basket — otherwise the user sees two identical purchase tasks
    // for the same supplier, which has been reported as confusing UX.
    const openSingleApprovals = await this.approvalRepo.find({
      where: {
        subjectType: 'procurement_draft',
        status:      In(['pending', 'modified']) as any,
      },
      select: ['id', 'subjectId', 'tenantId'],
      take: 500,
    });
    const openSingleApprovalByDraftId = new Map(
      openSingleApprovals.map(a => [a.subjectId, a]),
    );
    const supersedableDrafts = openSingleApprovals.length
      ? await this.draftRepo.find({
          where: {
            id:     In(openSingleApprovals.map(a => a.subjectId)),
            status: 'pending_review' as any,
          },
        })
      : [];

    const drafts = [...newDrafts, ...supersedableDrafts];
    if (drafts.length === 0) return;

    const productIds  = Array.from(new Set(drafts.map(d => d.productId)));
    const supplierIds = Array.from(new Set(drafts.map(d => d.supplierTenantId)));
    const draftIds    = drafts.map(d => d.id);

    const [products, suppliers, existing, listings] = await Promise.all([
      productIds.length
        ? this.productRepo.find({ where: { id: In(productIds) } })
        : Promise.resolve([]),
      supplierIds.length
        ? this.tenantRepo.find({ where: { id: In(supplierIds) } })
        : Promise.resolve([]),
      this.approvalRepo.find({
        where: { subjectType: 'procurement_draft', subjectId: In(draftIds) },
        select: ['subjectId'],
      }),
      productIds.length && supplierIds.length
        ? this.catalogRepo.find({
            where: {
              productId:        In(productIds),
              supplierTenantId: In(supplierIds),
              isAvailable:      true,
            },
            select: ['productId', 'supplierTenantId', 'stock'],
          })
        : Promise.resolve([]),
    ]);

    const productById  = new Map(products.map(p => [p.id, p]));
    const supplierById = new Map(suppliers.map(s => [s.id, s]));
    const seen         = new Set(existing.map(a => a.subjectId));
    // Pre-flight set: only drafts whose (productId, supplierTenantId) tuple
    // still has an *available* listing should ever reach the human queue.
    const listingKey   = (productId: string, supplierTenantId: string) =>
      `${productId}::${supplierTenantId}`;
    const availableListings = new Map<string, number>();
    for (const l of listings) {
      availableListings.set(listingKey(l.productId, l.supplierTenantId), Number(l.stock ?? 0));
    }

    let created = 0;
    let preflightExpired = 0;
    let supersededApprovals = 0;

    // Step 1 — pre-flight every draft against its supplier listing. Drafts
    // that pass become candidates for basket grouping; failures are expired
    // in-place so the cron never re-picks them.
    // NOTE: supersedable drafts (already have a single approval) DO enter the
    // candidate pool — they will be regrouped if a new draft joins their
    // supplier, otherwise the existing single approval stays untouched.
    const candidates: ProcurementDraft[] = [];
    for (const d of drafts) {
      const isSupersedable = openSingleApprovalByDraftId.has(d.id);
      if (seen.has(d.id) && !isSupersedable) continue;

      // Pre-flight #1: supplier no longer carries this product → expire the
      // draft so the cron stops re-picking it, and skip approval.
      const key = listingKey(d.productId, d.supplierTenantId);
      const stock = availableListings.get(key);
      if (stock === undefined) {
        try {
          await this.draftRepo.update(d.id, {
            status:          'expired' as any,
            rejectionReason: 'No active supplier listing for this product anymore',
          });
          preflightExpired++;
        } catch (err) {
          this.logger.warn(`pre-flight expire failed (${d.id}): ${(err as Error).message}`);
        }
        continue;
      }

      // Pre-flight #2: supplier listing exists but stock is insufficient.
      // We still surface the approval (the listing might restock), but tag
      // the draft urgency context — UI can decide to warn the pharmacist.
      // Note: stock=0 means "available but quantity unknown" in current
      // schema, so we only block when stock is positive AND below request.
      if (stock > 0 && stock < d.suggestedQuantity) {
        try {
          await this.draftRepo.update(d.id, {
            status:          'expired' as any,
            rejectionReason: `Supplier stock (${stock}) is below requested quantity (${d.suggestedQuantity})`,
          });
          preflightExpired++;
        } catch (err) {
          this.logger.warn(`pre-flight expire (low-stock) failed (${d.id}): ${(err as Error).message}`);
        }
        continue;
      }

      candidates.push(d);
    }

    // Step 2 — group by (pharmacyTenantId, supplierTenantId). Each group
    // becomes ONE approval: either a single-line "procurement_draft" (back-
    // compat, identical to old behaviour) or a multi-line
    // "procurement_basket" when 2+ products share the same supplier.
    const groups = new Map<string, ProcurementDraft[]>();
    for (const d of candidates) {
      const k = `${d.pharmacyTenantId}::${d.supplierTenantId}`;
      const arr = groups.get(k);
      if (arr) arr.push(d);
      else groups.set(k, [d]);
    }

    for (const groupDrafts of groups.values()) {
      try {
        // Collect any pre-existing single approvals attached to drafts in
        // this group — they will be superseded if we end up creating a
        // basket (multi-draft group).
        const oldSingleApprovalIds = groupDrafts
          .map(d => openSingleApprovalByDraftId.get(d.id)?.id)
          .filter((id): id is string => !!id);

        if (groupDrafts.length === 1) {
          const d = groupDrafts[0];
          // Idempotent: a lone draft that already has its single approval —
          // nothing to do, keep showing the existing task.
          if (oldSingleApprovalIds.length > 0) continue;

          const approval = await this.createDraftApproval(
            d,
            productById.get(d.productId),
            supplierById.get(d.supplierTenantId),
          );
          if (approval) {
            await this.draftRepo.update(d.id, { basketApprovalId: approval.id });
            await this.notifyProcurementApproval(approval, {
              kind: 'single',
              supplierName: supplierById.get(d.supplierTenantId)?.name || 'المورد',
              productCount: 1,
              productLabel: productById.get(d.productId)?.nameAr
                            || productById.get(d.productId)?.name
                            || 'منتج',
              totalCost: Number(d.unitPrice) * d.suggestedQuantity,
              currency: d.currency,
              expiresAt: d.expiresAt,
            });
            created++;
          }
        } else {
          const approval = await this.createSupplierBasketApproval(
            groupDrafts,
            productById,
            supplierById.get(groupDrafts[0].supplierTenantId),
          );
          if (approval) {
            await this.draftRepo.update(
              { id: In(groupDrafts.map(d => d.id)) },
              { basketApprovalId: approval.id },
            );
            // Roll-up: delete the now-redundant single approvals so the user
            // sees ONE basket task per supplier instead of N identical singles.
            if (oldSingleApprovalIds.length > 0) {
              try {
                await this.approvalRepo.delete({ id: In(oldSingleApprovalIds) });
                supersededApprovals += oldSingleApprovalIds.length;
              } catch (err) {
                this.logger.warn(`supersede old single approval(s) failed: ${(err as Error).message}`);
              }
            }
            await this.notifyProcurementApproval(approval, {
              kind: 'basket',
              supplierName: supplierById.get(groupDrafts[0].supplierTenantId)?.name || 'المورد',
              productCount: groupDrafts.length,
              productLabel: null,
              totalCost: groupDrafts.reduce(
                (s, d) => s + Number(d.unitPrice) * d.suggestedQuantity, 0,
              ),
              currency: groupDrafts[0].currency,
              expiresAt: new Date(
                groupDrafts.map(d => d.expiresAt.getTime()).reduce((a, b) => Math.min(a, b)),
              ),
            });
            created++;
          }
        }
      } catch (err) {
        this.logger.error(`basket/draft approval failed: ${(err as Error).message}`);
      }
    }
    if (created)         this.logger.log(`Purchase-Expert: created ${created} approval(s) from drafts`);
    if (preflightExpired) this.logger.warn(`Purchase-Expert: pre-flight expired ${preflightExpired} draft(s) — supplier listing missing or insufficient`);
    if (supersededApprovals) this.logger.log(`Purchase-Expert: superseded ${supersededApprovals} single approval(s) — rolled up into baskets`);
  }

  private async createDraftApproval(
    d: ProcurementDraft,
    product: Product | undefined,
    supplier: Tenant | undefined,
  ): Promise<Approval | null> {
    const productName  = product?.nameAr || product?.name || 'المنتج';
    const supplierName = supplier?.name  || 'المورد';
    const unitPrice    = Number(d.unitPrice);
    const subtotal     = unitPrice * d.suggestedQuantity;
    const totalVat     = Math.round(subtotal * 1.15 * 100) / 100;

    const priority: 'critical' | 'high' | 'medium' =
      d.urgencyLevel === 'critical' ? 'critical' :
      d.urgencyLevel === 'high'     ? 'high'     : 'medium';

    // ── P4: surface Decision-Engine verdicts on the approval card ────────────
    // When the draft was produced by ProcurementOrchestrator we copy the
    // financial + delay + overpayment slices of planSnapshot into the approval
    // payload so the UI can render badges (credit utilisation, "wait N days",
    // "above market avg") without making a second API call.
    const snap = (d.planSnapshot ?? null) as Record<string, any> | null;
    const planVerdicts = snap && d.sourceType === 'ai_plan' ? {
      financialStatus:           snap.financialStatus           ?? null,
      delayRecommendation:       snap.delayRecommendation       ?? null,
      overpaymentRecommendation: snap.overpaymentRecommendation ?? null,
      riskScore:                 typeof snap.riskScore  === 'number' ? snap.riskScore  : null,
      planConfidence:            typeof snap.confidence === 'number' ? snap.confidence : null,
      signalFreshnessAt:         d.signalFreshnessAt ? d.signalFreshnessAt.toISOString() : null,
    } : null;

    return this.approvals.create(d.pharmacyTenantId, {
      agentCode:   'purchase_expert',
      subjectType: 'procurement_draft',
      subjectId:   d.id,
      // Single-product draft — same restock need surfaces here too.
      // Multi-product baskets stay unique (no needKey) on createSupplierBasketApproval.
      needKey:     `restock::${d.productId}`,
      title:       `طلب شراء: ${productName} × ${d.suggestedQuantity}`,
      summary:     `من ${supplierName} بسعر ${unitPrice.toFixed(2)} ${d.currency} للوحدة · الإجمالي قبل الضريبة ${subtotal.toFixed(2)} ${d.currency} (≈ ${totalVat.toFixed(2)} مع الضريبة).`,
      rationale:   `اقتراح بناءً على توصية المخزون (مخاطر نفاد). تم اختيار المورد وفقاً لأعلى موثوقية وأفضل سعر متاح.`,
      confidence:  0.85,
      priority,
      payload: {
        draftId:      d.id,
        productId:    d.productId,
        productName,
        supplierId:   d.supplierTenantId,
        supplierName,
        quantity:     d.suggestedQuantity,
        unitPrice,
        currency:     d.currency,
        subtotal,
        urgencyLevel: d.urgencyLevel,
        // P4 — null when the draft predates the Decision Engine
        planVerdicts,
      },
      confidenceReason: `تم اختيار ${supplierName} وفقاً لأفضل سعر وأعلى موثوقية تسليم مسجلة، وبناءً على احتياج أوصى به خبير المخزون.`,
      expiresAt:      d.expiresAt.toISOString(),
    });
  }

  /**
   * Supplier-basket approval: a single composite "PO" representing multiple
   * urgent products that should all be ordered from the same supplier today.
   *
   * Why one approval (not N): in practice the pharmacist wants to make ONE
   * decision per supplier per day — bundle into a single shipment with one
   * invoice. The payload carries each line item so the executor can build a
   * real Order with multiple OrderItems atomically.
   *
   * Idempotency: every draft folded into this basket has its
   * `basketApprovalId` set immediately after creation, so the 5-minute scan
   * will not re-pick them.
   */
  private async createSupplierBasketApproval(
    drafts:       ProcurementDraft[],
    productById:  Map<string, Product>,
    supplier:     Tenant | undefined,
  ): Promise<Approval | null> {
    const supplierName = supplier?.name || 'المورد';
    const tenantId     = drafts[0].pharmacyTenantId;
    const currency     = drafts[0].currency;

    let subtotal = 0;
    const items = drafts.map(d => {
      const product     = productById.get(d.productId);
      const productName = product?.nameAr || product?.name || 'المنتج';
      const unitPrice   = Number(d.unitPrice);
      const lineTotal   = unitPrice * d.suggestedQuantity;
      subtotal += lineTotal;
      return {
        draftId:      d.id,
        productId:    d.productId,
        productName,
        quantity:     d.suggestedQuantity,
        unitPrice,
        lineTotal,
        urgencyLevel: d.urgencyLevel,
      };
    });

    const totalVat = Math.round(subtotal * 1.15 * 100) / 100;

    // Earliest expiry across the basket — once any line goes stale, the
    // whole basket should be revisited.
    const earliestExpiry = drafts
      .map(d => d.expiresAt.getTime())
      .reduce((a, b) => Math.min(a, b), Infinity);

    // Priority = highest urgency in the basket. Critical bubbles up.
    const priority: 'critical' | 'high' | 'medium' =
      drafts.some(d => d.urgencyLevel === 'critical') ? 'critical' :
      drafts.some(d => d.urgencyLevel === 'high')     ? 'high'     : 'medium';

    // ── P4: aggregate Decision-Engine verdicts across the basket ────────────
    // Financial status is tenant-level → all snapshots agree; pick first non-null.
    // Delay rec is also tenant-level → pick the highest-confidence one.
    // Overpayment is per product → surface the worst overpayment % so the
    // pharmacist sees the most pressing alternative before approving.
    const snaps = drafts
      .map(d => (d.planSnapshot ?? null) as Record<string, any> | null)
      .filter((s): s is Record<string, any> => !!s);
    const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const firstFinancial = snaps.find(s => s.financialStatus)?.financialStatus ?? null;
    const bestDelay = snaps
      .map(s => s.delayRecommendation)
      .filter(Boolean)
      .sort((a, b) => (confidenceRank[b?.confidence] ?? 0) - (confidenceRank[a?.confidence] ?? 0))[0] ?? null;
    const worstOverpay = snaps
      .map(s => s.overpaymentRecommendation)
      .filter(Boolean)
      .sort((a, b) => (b?.overpaymentPct ?? 0) - (a?.overpaymentPct ?? 0))[0] ?? null;
    const worstRisk = snaps
      .map(s => typeof s.riskScore === 'number' ? s.riskScore : 0)
      .reduce((m, v) => Math.max(m, v), 0);
    const planVerdicts = snaps.length > 0 ? {
      financialStatus:           firstFinancial,
      delayRecommendation:       bestDelay,
      overpaymentRecommendation: worstOverpay,
      riskScore:                 worstRisk || null,
      planConfidence:            null,
      signalFreshnessAt:         drafts[0].signalFreshnessAt
                                   ? drafts[0].signalFreshnessAt.toISOString()
                                   : null,
    } : null;

    return this.approvals.create(tenantId, {
      agentCode:   'purchase_expert',
      subjectType: 'procurement_basket',
      subjectId:   drafts[0].id, // primary draft — kept for back-compat lookup
      title:       `سلة شراء: ${items.length} منتجات من ${supplierName}`,
      summary:     `${items.length} أصناف عاجلة من ${supplierName} · الإجمالي قبل الضريبة ${subtotal.toFixed(2)} ${currency} (≈ ${totalVat.toFixed(2)} مع الضريبة).`,
      rationale:   `جمعنا ${items.length} منتجات يحتاج كلٌّ منها إلى إعادة طلب اليوم في طلب شراء واحد من نفس المورد — لتقليل تكلفة الشحن وتسريع التسليم.`,
      confidence:  0.85,
      priority,
      payload: {
        kind:         'supplier_basket',
        supplierId:   drafts[0].supplierTenantId,
        supplierName,
        currency,
        items,
        draftIds:     drafts.map(d => d.id),
        subtotal,
        totalVat,
        planVerdicts,
      },
      confidenceReason: `تم تجميع طلبات متعددة لنفس المورد بناءً على توصيات المخزون الحالية وأفضل سعر متاح لكل صنف.`,
      expiresAt:        new Date(earliestExpiry).toISOString(),
    });
  }

  // ── 3) Catalog Expert: scan suggested links ─────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'catalog-expert-bridge' })
  async scanCatalogSuggestions(): Promise<void> {
    const items = await this.itemRepo.find({
      where: {
        linkStatus: 'suggested' as any,
        deletedAt:  IsNull() as any,
      },
      order: { updatedAt: 'ASC' },
      take: 200,
    });
    if (items.length === 0) return;

    const existing = await this.approvalRepo.find({
      where: {
        subjectType: 'inventory_item',
        agentCode:   'catalog_expert',
        subjectId:   In(items.map(i => i.id)),
      },
      select: ['subjectId'],
    });
    const seen = new Set(existing.map(a => a.subjectId));

    const suggestedIds = items
      .map(i => (i.matchExplanation as any)?.suggestedProductId as string | undefined)
      .filter((x): x is string => !!x);
    const suggestedProducts = suggestedIds.length
      ? await this.productRepo.find({ where: { id: In(Array.from(new Set(suggestedIds))) } })
      : [];
    const suggestedById = new Map(suggestedProducts.map(p => [p.id, p]));

    let created = 0;
    for (const item of items) {
      if (seen.has(item.id)) continue;
      const expl = (item.matchExplanation as any) ?? {};
      const suggestedProductId: string | undefined = expl.suggestedProductId;
      if (!suggestedProductId) continue;
      const suggested = suggestedById.get(suggestedProductId);
      if (!suggested) continue;
      try {
        await this.createCatalogApproval(item, suggested);
        created++;
      } catch (err) {
        this.logger.error(`catalog approval failed (${item.id}): ${(err as Error).message}`);
      }
    }
    if (created) this.logger.log(`Catalog-Expert: created ${created} approval(s) from suggestions`);
  }

  /**
   * Fire an in-app notification when the bridge creates a new procurement
   * approval (single draft or supplier basket). Best-effort — a failure to
   * deliver the notification never blocks approval creation. We always
   * stamp `resourceRef = "approval:<id>"` so the bell-click can deep-link
   * into the AI Center / Tasks tab on the matching card.
   */
  private async notifyProcurementApproval(
    approval: Approval,
    info: {
      kind: 'single' | 'basket';
      supplierName: string;
      productCount: number;
      productLabel: string | null;
      totalCost: number;
      currency: string;
      expiresAt: Date;
    },
  ): Promise<void> {
    try {
      const totalFmt = info.totalCost.toLocaleString('ar-EG', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      const deadlineFmt = info.expiresAt.toLocaleString('ar-EG', {
        day:   'numeric',
        month: 'short',
        hour:  '2-digit',
        minute:'2-digit',
      });

      const title =
        info.kind === 'basket'
          ? `خطة شراء جديدة: ${info.productCount} منتجات من ${info.supplierName}`
          : `طلب شراء جديد: ${info.productLabel} من ${info.supplierName}`;

      const body =
        info.kind === 'basket'
          ? `إجمالي ${totalFmt} ${info.currency} قبل الضريبة — راجعها قبل ${deadlineFmt}.`
          : `بقيمة ${totalFmt} ${info.currency} قبل الضريبة — راجعها قبل ${deadlineFmt}.`;

      await this.notifications.create({
        tenantId:    approval.tenantId,
        type:        'draft_created',
        title,
        body,
        resourceRef: `approval:${approval.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `notifyProcurementApproval failed for ${approval.id}: ${(err as Error).message}`,
      );
    }
  }

  private async createCatalogApproval(item: InventoryItem, suggested: Product): Promise<void> {
    const expl       = (item.matchExplanation as any) ?? {};
    const score      = Number(item.matchScore ?? 0);
    const signals: string[] = Array.isArray(expl.signals) ? expl.signals : [];
    const reasonText = signals.map(s => SIGNAL_AR[s] ?? s).join(' · ') || 'تطابق جزئي';
    const targetName = suggested.nameAr || suggested.name;

    await this.approvals.create(item.pharmacyTenantId, {
      agentCode:   'catalog_expert',
      subjectType: 'inventory_item',
      subjectId:   item.id,
      title:       `ربط مقترح: ${targetName}`,
      summary:     `هذا الصنف يبدو أنه نفس المنتج: ${targetName} (دقة المطابقة ${score.toFixed(0)}%).`,
      rationale:   `الإشارات المؤيدة: ${reasonText}.`,
      confidence:  Math.max(0, Math.min(1, score / 100)),
      priority:    score >= 90 ? 'high' : 'medium',
      payload: {
        itemId:               item.id,
        suggestedProductId:   suggested.id,
        suggestedProductName: targetName,
        matchScore:           score,
        signals,
      },
      confidenceReason: `درجة التطابق ${score.toFixed(0)}% بناءً على ${signals.length} إشارة${signals.length > 1 ? '' : ''} مؤيدة${reasonText ? `: ${reasonText}` : ''}.`,
      expiresAt:      new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    });
  }

  // ── Recommendation approval — dispatch by recommendation type ──────────────

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'recommendation') return;
    try {
      const rec = await this.recRepo.findOne({
        where: { id: approval.subjectId, pharmacyTenantId: approval.tenantId },
        relations: ['product'],
      });
      if (!rec) {
        await this.approvals.markExecuted(approval.tenantId, approval.id, { note: 'rec_not_found' });
        return;
      }
      switch (rec.type as string) {
        case RecommendationType.REORDER:
          await this.executeReorder(approval, rec);
          break;
        case RecommendationType.SMART_PROCUREMENT:
          await this.executeSmartProcurement(approval, rec);
          break;
        case RecommendationType.P2P_LISTING_SUGGESTION:
        case RecommendationType.DEAD_STOCK_ALERT:
          await this.executeP2pListing(approval, rec);
          break;
        case RecommendationType.EXPIRED_QUARANTINE:
          await this.executeQuarantine(approval, rec);
          break;
        default:
          await this.approvals.markExecuted(approval.tenantId, approval.id, { note: 'acknowledged' });
      }
    } catch (err) {
      this.logger.warn(`onApproved (recommendation) failed: ${(err as Error).message}`);
    }
  }

  private async executeSmartProcurement(approval: Approval, rec: AiRecommendation): Promise<void> {
    // Approving SMART_PROCUREMENT = user wants to buy from the P2P listing.
    // We mark executed and return the deep-link so the frontend can navigate there.
    const deepLink   = rec.payload?.deepLink as string | undefined ?? '/pharmacy/p2p?tab=buy';
    const productId  = rec.productId ?? (rec.payload?.productId as string | undefined);
    const listingId  = rec.payload?.bestListing?.listingId as string | undefined;

    await this.approvals.markExecuted(approval.tenantId, approval.id, {
      action:    'navigate_to_p2p_marketplace',
      deepLink:  listingId
        ? `/pharmacy/p2p?tab=buy&productId=${productId}&highlightListing=${listingId}`
        : deepLink,
      productId,
      listingId,
    });
    this.logger.log(`SMART_PROCUREMENT approved for product ${productId} → user directed to P2P marketplace`);
  }

  private async executeReorder(approval: Approval, rec: AiRecommendation): Promise<void> {
    const productId = rec.productId ?? (rec.payload?.productId as string | undefined);
    if (!productId) throw new Error('No productId on recommendation');

    // Find cheapest available supplier
    const [catalog] = await this.catalogRepo.find({
      where: { productId, isAvailable: true },
      order: { price: 'ASC' },
      take: 1,
    });

    if (!catalog) {
      // Fallback: check P2P marketplace before giving up
      const [p2pListing] = await this.dataSource.query<{ id: string }[]>(`
        SELECT pl.id
        FROM p2p_listings pl
        JOIN seller_profiles sp_seller ON sp_seller."pharmacyTenantId" = pl."sellerTenantId"
          AND sp_seller."verificationStatus" = 'verified'
        JOIN seller_profiles sp_buyer ON sp_buyer."pharmacyTenantId" = $2
          AND sp_buyer.city = sp_seller.city
        WHERE pl."productId" = $1
          AND pl.status      = 'active'
          AND pl.quantity    > 0
          AND pl."sellerTenantId" != $2
        LIMIT 1
      `, [productId, approval.tenantId]);

      if (p2pListing) {
        await this.approvals.markExecuted(approval.tenantId, approval.id, {
          action:     'navigate_to_p2p_marketplace',
          deepLink:   `/pharmacy/p2p?tab=marketplace&productId=${productId}`,
          productId,
          listingId:  p2pListing.id,
          sourceType: 'p2p_fallback',
        });
        this.logger.log(
          `REORDER: no catalog supplier for ${productId} — P2P fallback listing ${p2pListing.id}`,
        );
        return;
      }

      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        warning: 'لم يتم العثور على مورد متاح في الكتالوج أو البورصة الدوائية — تحقق من كتالوج الموردين',
      });
      return;
    }

    const quantity = Math.max(
      1,
      Math.round(Number(
        rec.payload?.deficit ??
        rec.payload?.suggestedReorderQty ??
        rec.payload?.minThreshold ??
        10,
      )),
    );

    const draft = this.draftRepo.create({
      pharmacyTenantId: approval.tenantId,
      supplierTenantId: catalog.supplierTenantId,
      productId,
      suggestedQuantity: quantity,
      unitPrice:        Number(catalog.price ?? 0),
      currency:         'EGP',
      urgencyLevel:     rec.riskLevel === 'HIGH' ? 'critical' : rec.riskLevel === 'MEDIUM' ? 'high' : 'medium',
      recommendationId: rec.id,
      status:           'pending_review',
      expiresAt:        new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    await this.draftRepo.save(draft);

    await this.approvals.markExecuted(approval.tenantId, approval.id, {
      draftId:          draft.id,
      supplierTenantId: catalog.supplierTenantId,
      quantity:         draft.suggestedQuantity,
      unitPrice:        draft.unitPrice,
    });
    this.logger.log(`REORDER approved for product ${productId} → draft ${draft.id}`);
  }

  private async executeP2pListing(approval: Approval, rec: AiRecommendation): Promise<void> {
    const inventoryItemId = rec.payload?.inventoryItemId as string | undefined;
    const productId = rec.productId ?? (rec.payload?.productId as string | undefined);
    if (!inventoryItemId || !productId) throw new Error('Missing inventoryItemId or productId in payload');

    const listingRepo = this.dataSource.getRepository('p2p_listings');

    // Check if already listed
    const existing = await listingRepo.findOne({ where: { inventoryItemId, status: 'active' } }) as any;
    if (existing) {
      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        listingId: existing.id,
        note:      'already_listed',
      });
      return;
    }

    const discountPct  = Number(rec.payload?.suggestedDiscountPct ?? 10);
    const item = await this.itemRepo.findOne({ where: { id: inventoryItemId } });
    const costPrice    = Number(item?.costPrice ?? 0);
    const listingPrice = costPrice > 0
      ? parseFloat((costPrice * (1 - discountPct / 100)).toFixed(2))
      : 0;

    const listing = listingRepo.create({
      sellerTenantId:     approval.tenantId,
      inventoryItemId,
      productId,
      price:              listingPrice,
      quantity:           Number(rec.payload?.quantity ?? item?.quantity ?? 1),
      minOrderQty:        1,
      expiryDate:         rec.payload?.expiryDate ? new Date(rec.payload.expiryDate as string) : null,
      listingType:        'clearance',
      offerType:          discountPct > 0 ? 'discount' : 'none',
      discountPct:        discountPct > 0 ? discountPct : null,
      autoUpdateDiscount: true,
      status:             'active',
    });
    const saved = await listingRepo.save(listing) as any;

    await this.approvals.markExecuted(approval.tenantId, approval.id, {
      listingId: saved.id,
      price:     listingPrice,
      discountPct,
    });
    this.logger.log(`P2P listing created for item ${inventoryItemId} → listing ${saved.id}`);
  }

  private async executeQuarantine(approval: Approval, rec: AiRecommendation): Promise<void> {
    const inventoryItemId = rec.payload?.inventoryItemId as string | undefined;
    if (!inventoryItemId) throw new Error('Missing inventoryItemId for quarantine');

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE inventory_items SET quantity = 0 WHERE id = $1 AND "pharmacyTenantId" = $2`,
        [inventoryItemId, approval.tenantId],
      );
    });

    await this.approvals.markExecuted(approval.tenantId, approval.id, {
      quarantinedItemId: inventoryItemId,
    });
    this.logger.log(`Quarantine executed for item ${inventoryItemId}`);
  }

  // ── Manual backfill — used by the dev "sync now" endpoint and by tests ──

  /**
   * Idempotently produce approvals for all *pending* signals belonging to
   * `tenantId` — REORDER recommendations, pending_review drafts, and
   * suggested catalog links — without waiting for cron or events.
   *
   * Returns per-source created/skipped counts so the caller can show a
   * truthful confirmation toast.
   */
  async backfillTenant(tenantId: string): Promise<{
    recommendations: { created: number; existed: number };
    procurement:     { created: number; existed: number };
    catalog:         { created: number; existed: number };
  }> {
    const result = {
      recommendations: { created: 0, existed: 0 },
      procurement:     { created: 0, existed: 0 },
      catalog:         { created: 0, existed: 0 },
    };

    // Run the rules engine (no GPT). Returns the full current set of active
    // recommendations using upsert — IDs are stable across repeated syncs so
    // the approval dedup check below never races with async event handlers.
    let currentRecs: AiRecommendation[] = [];
    try {
      currentRecs = await this.aiService.runRulesEngineOnly(tenantId);
    } catch (err) {
      this.logger.warn(`runRulesEngineOnly failed for tenant ${tenantId}: ${(err as Error).message}`);
    }

    const handledTypes = new Set([
      RecommendationType.REORDER,
      RecommendationType.DEAD_STOCK_ALERT,
      RecommendationType.P2P_LISTING_SUGGESTION,
      RecommendationType.EXPIRED_QUARANTINE,
      RecommendationType.SMART_PROCUREMENT,
    ]);

    // Use recs returned by the engine directly — no re-query, no async race.
    const activeRecIds = new Set(currentRecs.map(r => r.id));
    for (const rec of currentRecs) {
      if (!handledTypes.has(rec.type as any)) continue;

      // Only block on ACTIVE approvals (pending/modified/approved).
      // Executed, rejected, or expired approvals allow re-approval so the
      // user can retry after a failed execution (e.g. no supplier found) or
      // reconsider a rejected recommendation. For executed approvals we also
      // check whether execution actually succeeded — if it did (draft created,
      // listing created, etc.) we treat the work as done and skip.
      const lastApproval = await this.approvalRepo.findOne({
        where: { tenantId, subjectType: 'recommendation', subjectId: rec.id },
        order: { createdAt: 'DESC' },
      });
      if (lastApproval) {
        const { status } = lastApproval;
        if (status === 'pending' || status === 'modified' || status === 'approved') {
          result.recommendations.existed++;
          continue;
        }
        if (status === 'executed' && this.wasSuccessfulExecution(rec, lastApproval)) {
          result.recommendations.existed++;
          continue;
        }
        // rejected / expired / executed-with-failure → fall through and create new approval
      }
      try {
        if (rec.type === RecommendationType.REORDER) {
          await this.ensureApprovalForRecommendation(rec);
        } else if (rec.type === RecommendationType.SMART_PROCUREMENT) {
          await this.ensureSmartProcurementApproval(rec);
        } else {
          await this.ensureRiskApprovalForRecommendation(rec);
        }
        result.recommendations.created++;
      } catch (err) {
        this.logger.warn(`backfill rec ${rec.id} failed: ${(err as Error).message}`);
      }
    }

    // Expire pending approvals whose rec was dismissed (no longer triggered).
    // Without this, every sync accumulates stale "pending" cards in AI Center.
    try {
      const stalePending = await this.approvalRepo
        .createQueryBuilder('a')
        .where('a.tenantId = :tenantId', { tenantId })
        .andWhere('a.subjectType = :t', { t: 'recommendation' })
        .andWhere('a.status IN (:...statuses)', { statuses: ['pending', 'modified'] })
        .getMany();
      const toExpire = stalePending.filter(a => !activeRecIds.has(a.subjectId));
      for (const stale of toExpire) {
        await this.approvalRepo.update(stale.id, { status: 'expired' as any });
      }
      if (toExpire.length) {
        this.logger.log(`Sync: expired ${toExpire.length} stale recommendation approval(s)`);
      }
    } catch (err) {
      this.logger.warn(`expire stale approvals failed: ${(err as Error).message}`);
    }

    // Drafts + catalog: re-use the cron scanners. They're tenant-agnostic but
    // idempotent, so calling them is safe.
    const beforeDraft = await this.approvalRepo.count({
      where: { tenantId, subjectType: 'procurement_draft' },
    });
    await this.scanProcurementDrafts();
    const afterDraft  = await this.approvalRepo.count({
      where: { tenantId, subjectType: 'procurement_draft' },
    });
    result.procurement.created = Math.max(0, afterDraft - beforeDraft);
    result.procurement.existed = beforeDraft;

    const beforeLink = await this.approvalRepo.count({
      where: { tenantId, subjectType: 'inventory_item' },
    });
    await this.scanCatalogSuggestions();
    const afterLink  = await this.approvalRepo.count({
      where: { tenantId, subjectType: 'inventory_item' },
    });
    result.catalog.created = Math.max(0, afterLink - beforeLink);
    result.catalog.existed = beforeLink;

    return result;
  }

  /**
   * Returns true when a previous 'executed' approval for this recommendation
   * represents a SUCCESSFUL execution that makes re-approval unnecessary.
   *
   * Failure cases (no supplier, listing already existed, etc.) return false
   * so the user gets a fresh approval card after the condition is fixed.
   */
  private wasSuccessfulExecution(rec: AiRecommendation, approval: Approval): boolean {
    const r = approval.executionResult ?? {};
    switch (rec.type as string) {
      case RecommendationType.REORDER:
        // Draft was created → procurement in flight
        return !!r.draftId;
      case RecommendationType.P2P_LISTING_SUGGESTION:
      case RecommendationType.DEAD_STOCK_ALERT:
        // P2P listing was newly created (not 'already_listed')
        return !!r.listingId && r.note !== 'already_listed';
      case RecommendationType.EXPIRED_QUARANTINE:
        // Item was quarantined
        return !!r.quarantinedItemId;
      case RecommendationType.SMART_PROCUREMENT:
        // We can't know if the user actually bought — always allow re-approval
        return false;
      default:
        // Advisory acknowledgement — acknowledged once is enough
        return r.note === 'acknowledged';
    }
  }
}

// Plain-Arabic labels for catalog match signals. Keep in sync with the codes
// produced by `catalog-matching.service.ts`.
const SIGNAL_AR: Record<string, string> = {
  barcode_exact:      'الباركود مطابق تماماً',
  name_exact:         'الاسم مطابق تماماً',
  name_strong:        'الاسم مطابق بشكل قوي',
  name_partial:       'تطابق جزئي بالاسم',
  manufacturer_match: 'الشركة المصنعة متطابقة',
  strength_match:     'التركيز متطابق',
  form_match:         'الشكل الصيدلاني متطابق',
};

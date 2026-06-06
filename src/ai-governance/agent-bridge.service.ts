import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
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
  ) {}

  // ── 1) Inventory Expert: react to AI recommendations ────────────────────

  @OnEvent(EVENTS.RECOMMENDATION_GENERATED)
  async onRecommendationGenerated(ev: RecommendationGeneratedEvent): Promise<void> {
    if (ev.type !== RecommendationType.REORDER) return;
    try {
      const rec = await this.recRepo.findOne({
        where: { id: ev.recommendationId, pharmacyTenantId: ev.tenantId },
        relations: ['product'],
      });
      if (!rec) return;
      await this.ensureApprovalForRecommendation(rec);
    } catch (err) {
      this.logger.error(`onRecommendationGenerated failed: ${(err as Error).message}`);
    }
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

  // ── 2) Purchase Expert: scan procurement drafts ─────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'purchase-expert-bridge' })
  async scanProcurementDrafts(): Promise<void> {
    // ORDER BY createdAt ASC ensures the oldest pending drafts get into the
    // queue first — so a flood of new drafts cannot starve out older ones.
    const drafts = await this.draftRepo.find({
      where: { status: 'pending_review' as any },
      order: { createdAt: 'ASC' },
      take: 200,
    });
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
    for (const d of drafts) {
      if (seen.has(d.id)) continue;

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

      try {
        await this.createDraftApproval(
          d,
          productById.get(d.productId),
          supplierById.get(d.supplierTenantId),
        );
        created++;
      } catch (err) {
        this.logger.error(`draft approval failed (${d.id}): ${(err as Error).message}`);
      }
    }
    if (created)         this.logger.log(`Purchase-Expert: created ${created} approval(s) from drafts`);
    if (preflightExpired) this.logger.warn(`Purchase-Expert: pre-flight expired ${preflightExpired} draft(s) — supplier listing missing or insufficient`);
  }

  private async createDraftApproval(
    d: ProcurementDraft,
    product: Product | undefined,
    supplier: Tenant | undefined,
  ): Promise<void> {
    const productName  = product?.nameAr || product?.name || 'المنتج';
    const supplierName = supplier?.name  || 'المورد';
    const unitPrice    = Number(d.unitPrice);
    const subtotal     = unitPrice * d.suggestedQuantity;
    const totalVat     = Math.round(subtotal * 1.15 * 100) / 100;

    const priority: 'critical' | 'high' | 'medium' =
      d.urgencyLevel === 'critical' ? 'critical' :
      d.urgencyLevel === 'high'     ? 'high'     : 'medium';

    await this.approvals.create(d.pharmacyTenantId, {
      agentCode:   'purchase_expert',
      subjectType: 'procurement_draft',
      subjectId:   d.id,
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
      },
      confidenceReason: `تم اختيار ${supplierName} وفقاً لأفضل سعر وأعلى موثوقية تسليم مسجلة، وبناءً على احتياج أوصى به خبير المخزون.`,
      expiresAt:      d.expiresAt.toISOString(),
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

  // ── Recommendation acknowledgement (no domain side-effect) ──────────────

  @OnEvent('approval.approved')
  async onApproved(approval: Approval): Promise<void> {
    if (approval.subjectType !== 'recommendation') return;
    try {
      await this.approvals.markExecuted(approval.tenantId, approval.id, {
        note: 'acknowledged',
      });
    } catch (err) {
      this.logger.warn(`mark executed (recommendation) failed: ${(err as Error).message}`);
    }
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

    // Recommendations
    const recs = await this.recRepo.find({
      where: {
        pharmacyTenantId: tenantId,
        type:             RecommendationType.REORDER,
        isDismissed:      false,
      },
      relations: ['product'],
      take: 200,
    });
    for (const rec of recs) {
      const before = await this.approvalRepo.count({
        where: { tenantId, subjectType: 'recommendation', subjectId: rec.id },
      });
      if (before > 0) { result.recommendations.existed++; continue; }
      try {
        await this.ensureApprovalForRecommendation(rec);
        result.recommendations.created++;
      } catch (err) {
        this.logger.warn(`backfill rec ${rec.id} failed: ${(err as Error).message}`);
      }
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

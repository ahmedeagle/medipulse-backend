import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, In } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { ProcurementSchedule } from '../forecasting/entities/procurement-schedule.entity';
import { ProcurementDraft } from './entities/procurement-draft.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { Role } from '../common/enums/role.enum';
import { RecommendationType } from '../common/enums/recommendation-type.enum';
import { EVENTS } from '../events/domain-events';
import { ProcurementOrchestrator } from './procurement-orchestrator.service';
import { OrchestratorResult, PlanSplit } from './procurement-orchestrator.types';

/**
 * Phase 4 close: auto-draft scheduler.
 *
 * Runs at 6am daily in the worker process.
 * Looks at ProcurementSchedule entries where daysUntilReorderNeeded <= 2.
 *
 * P1 (Decision Engine v1):
 *   - When AUTO_DRAFT_USE_DECISION_ENGINE=true (default), routes every urgent
 *     schedule through ProcurementOrchestrator.generatePlan() which considers
 *     supplier reliability, P2P alternatives, market shortage and financial
 *     health â€” then materialises one ProcurementDraft per supplier-split.
 *   - When the orchestrator returns a strong delayRecommendation, the draft is
 *     skipped and a "delay-suggested" notification is sent instead â€” protecting
 *     cash flow on tight days.
 *   - P2P splits are surfaced as notifications (drafts only model supplier POs).
 *   - When the flag is off, the legacy cheapest-only logic still runs.
 *
 * Design: idempotent â€” if a draft already exists for product+pharmacy+supplier,
 * skip it.
 */
@Injectable()
export class AutoDraftSchedulerService {
  private readonly logger = new Logger(AutoDraftSchedulerService.name);
  private readonly useDecisionEngine: boolean;

  constructor(
    @InjectRepository(ProcurementSchedule)
    private readonly scheduleRepo: Repository<ProcurementSchedule>,
    @InjectRepository(ProcurementDraft)
    private readonly draftRepo: Repository<ProcurementDraft>,
    @InjectRepository(AiRecommendation)
    private readonly recRepo: Repository<AiRecommendation>,
    @InjectRepository(SupplierCatalogItem)
    private readonly catalogRepo: Repository<SupplierCatalogItem>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly notificationSvc: NotificationService,
    private readonly emailSvc: NotificationEmailService,
    private readonly emitter: EventEmitter2,
    private readonly orchestrator: ProcurementOrchestrator,
    private readonly config: ConfigService,
  ) {
    this.useDecisionEngine =
      (this.config.get<string>('AUTO_DRAFT_USE_DECISION_ENGINE') ?? 'true')
        .toLowerCase() !== 'false';
  }

  @Cron('0 6 * * *')  // 6am daily
  async runDailyDraftGeneration(): Promise<void> {
    this.logger.log(
      `Auto-draft scheduler started â€” engine=${this.useDecisionEngine ? 'decision' : 'legacy_cheapest'}`,
    );
    try {
      await this._run();
    } catch (err: any) {
      this.logger.error(`Auto-draft scheduler failed: ${err.message}`, err.stack);
    }
  }

  private async _run(): Promise<void> {

    // Find all products where reorder is needed within 2 days
    const urgentSchedules = await this.scheduleRepo
      .createQueryBuilder('s')
      .where('s.daysUntilReorderNeeded <= :days', { days: 2 })
      .andWhere('s.reorderByDate IS NOT NULL')
      .getMany();

    if (!urgentSchedules.length) {
      this.logger.log('Auto-draft: no urgent schedules found');
      return;
    }

    let created = 0;
    let skipped = 0;
    let delayed = 0;

    for (const schedule of urgentSchedules) {
      const { tenantId, productId } = schedule;
      const eoqQty = schedule.eoqQty ? Math.ceil(Number(schedule.eoqQty)) : 10;

      if (this.useDecisionEngine) {
        const outcome = await this.runWithDecisionEngine(
          tenantId,
          productId,
          Math.max(1, eoqQty),
        );
        created += outcome.created;
        skipped += outcome.skipped;
        delayed += outcome.delayed;
      } else {
        const outcome = await this.runLegacyCheapest(schedule, eoqQty);
        created += outcome.created;
        skipped += outcome.skipped;
      }
    }

    this.logger.log(
      `Auto-draft complete: ${created} created, ${skipped} skipped, ${delayed} delayed (finance)`,
    );
  }

  // â”€â”€â”€ Decision Engine v1 path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async runWithDecisionEngine(
    tenantId:  string,
    productId: string,
    qtyNeeded: number,
  ): Promise<{ created: number; skipped: number; delayed: number }> {
    let plan: OrchestratorResult;
    try {
      plan = await this.orchestrator.generatePlan(tenantId, productId, qtyNeeded, {
        triggerEvent: 'low_stock',
      });
    } catch (err: any) {
      this.logger.error(
        `Decision Engine failed for tenant=${tenantId} product=${productId}: ${err.message}`,
      );
      // Don't lose the alert â€” fall back to legacy cheapest-only path.
      const schedule = await this.scheduleRepo.findOne({ where: { tenantId, productId } });
      if (!schedule) return { created: 0, skipped: 1, delayed: 0 };
      const out = await this.runLegacyCheapest(schedule, qtyNeeded);
      return { ...out, delayed: 0 };
    }

    // â”€â”€ P4 hook: honour strong delay recommendations (cash-flow protection) â”€â”€
    if (
      plan.delayRecommendation &&
      plan.delayRecommendation.confidence !== 'low' &&
      plan.financialStatus.recommendation === 'delay_recommended'
    ) {
      await this.notifyDelaySuggested(tenantId, productId, plan);
      return { created: 0, skipped: 0, delayed: 1 };
    }

    // â”€â”€ Materialise supplier splits as ProcurementDrafts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let created = 0;
    let skipped = 0;
    const supplierSplits = plan.splits.filter((s) => s.source === 'supplier');
    const p2pSplits      = plan.splits.filter((s) => s.source === 'p2p');

    for (const split of supplierSplits) {
      const inserted = await this.materialiseSupplierSplit(
        tenantId,
        productId,
        split,
        plan,
      );
      if (inserted) created++;
      else          skipped++;
    }

    // P2P splits â†’ notify (drafts only model supplier POs in current schema)
    if (p2pSplits.length > 0) {
      await this.notifyP2pOpportunity(tenantId, productId, p2pSplits, plan);
    }

    if (created > 0) {
      await this.notifyPharmacyAdmins(tenantId, productId, plan.qtyRequired);
    }

    return { created, skipped, delayed: 0 };
  }

  private async materialiseSupplierSplit(
    tenantId:  string,
    productId: string,
    split:     PlanSplit,
    plan:      OrchestratorResult,
  ): Promise<ProcurementDraft | null> {
    // Idempotency: one pending draft per (pharmacy, supplier, product)
    const existingDraft = await this.draftRepo.findOne({
      where: {
        pharmacyTenantId: tenantId,
        supplierTenantId: split.sourceId,
        productId,
        status:           'pending_review',
      },
    });
    if (existingDraft) return null;

    // Map plan urgency â†’ draft urgency
    const urgencyLevel: 'critical' | 'high' | 'medium' =
      plan.riskScore >= 70 ? 'critical'
    : plan.riskScore >= 40 ? 'high'
    :                        'medium';

    const expiresAt = new Date(Date.now() + 48 * 3_600_000);
    const supplierCatalog = await this.catalogRepo.findOne({
      where: { supplierTenantId: split.sourceId, productId, isAvailable: true },
    });
    const currency = supplierCatalog?.currency ?? 'SAR';

    // Best-matching active HIGH recommendation (optional link-back)
    const rec = await this.recRepo.findOne({
      where: {
        pharmacyTenantId: tenantId,
        productId,
        riskLevel:        'HIGH',
        type:             RecommendationType.REORDER,
        isDismissed:      false,
      },
      order: { createdAt: 'DESC' },
    });

    return this.draftRepo.save(
      this.draftRepo.create({
        pharmacyTenantId: tenantId,
        supplierTenantId: split.sourceId,
        productId,
        suggestedQuantity: split.qty,
        unitPrice:         split.unitPrice,
        currency,
        urgencyLevel,
        recommendationId:  rec?.id ?? null,
        expiresAt,
        sourceType:        'ai_plan',
        splitSource:       'supplier',
        p2pListingId:      null,
        planSnapshot:      plan as unknown as Record<string, unknown>,
        signalFreshnessAt: new Date(),
      }),
    );
  }

  private async notifyDelaySuggested(
    tenantId:  string,
    productId: string,
    plan:      OrchestratorResult,
  ): Promise<void> {
    const rec = plan.delayRecommendation!;
    try {
      await this.notificationSvc.create({
        tenantId,
        type:        'procurement_delay_suggested',
        title:       'ØªØ£Ø¬ÙŠÙ„ Ø§Ù„Ø´Ø±Ø§Ø¡ Ù…ÙÙ‚ØªØ±ÙŽØ­',
        body:        `${rec.humanReason} â€” ØªÙ… ØªØ£Ø¬ÙŠÙ„ ØªÙˆÙ„ÙŠØ¯ Ø·Ù„Ø¨ Ø§Ù„Ø´Ø±Ø§Ø¡ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ Ù„Ù€ ${rec.recommendedDelayDays} ÙŠÙˆÙ…. Ø±Ø§Ø¬Ø¹ â€œØªÙˆØµÙŠØ§Øª Ø§Ù„Ø°ÙƒØ§Ø¡â€ Ù„Ø§ØªØ®Ø§Ø° Ø§Ù„Ù‚Ø±Ø§Ø±.`,
        resourceRef: `product:${productId}`,
        emailSent:   false,
      });
    } catch (err: any) {
      this.logger.error(`Delay-suggested notification failed: ${err.message}`);
    }
  }

  private async notifyP2pOpportunity(
    tenantId:  string,
    productId: string,
    splits:    PlanSplit[],
    plan:      OrchestratorResult,
  ): Promise<void> {
    const totalQty   = splits.reduce((s, x) => s + x.qty, 0);
    const totalValue = splits.reduce((s, x) => s + x.qty * x.unitPrice, 0);
    try {
      await this.notificationSvc.create({
        tenantId,
        type:        'p2p_opportunity',
        title:       'ÙØ±ØµØ© Ø´Ø±Ø§Ø¡ Ù…Ù† Ø§Ù„Ø³ÙˆÙ‚ P2P',
        body:        `Ù…Ø­Ø±Ù‘Ùƒ Ø§Ù„Ù‚Ø±Ø§Ø± ÙˆØ¬Ø¯ ${splits.length} Ø¹Ø±Ø¶Ø§Ù‹ ÙÙŠ Ø³ÙˆÙ‚ P2P Ù„ØªØºØ·ÙŠØ© ${totalQty} ÙˆØ­Ø¯Ø© Ø¨Ù…ØªÙˆØ³Ø· Ø£Ø±Ø®Øµ (Ø¥Ø¬Ù…Ø§Ù„ÙŠ ~${totalValue.toFixed(0)}). Ø§ÙØªØ­ â€œØ§Ù„Ø³ÙˆÙ‚â€ Ù„Ù„Ù…Ø±Ø§Ø¬Ø¹Ø© Ù‚Ø¨Ù„ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø§Ù„Ø·Ù„Ø¨ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ.`,
        resourceRef: `product:${productId}`,
        emailSent:   false,
      });
    } catch (err: any) {
      this.logger.error(`P2P opportunity notification failed: ${err.message}`);
    }
  }

  // â”€â”€â”€ Legacy cheapest-only path (fallback) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async runLegacyCheapest(
    schedule: ProcurementSchedule,
    eoqQty:   number,
  ): Promise<{ created: number; skipped: number }> {
    const { tenantId, productId } = schedule;

    // Skip if pending draft already exists
    const existingDraft = await this.draftRepo.findOne({
      where: { pharmacyTenantId: tenantId, productId, status: 'pending_review' },
    });
    if (existingDraft) return { created: 0, skipped: 1 };

    // Pick best available supplier from catalog
    const listing = await this.catalogRepo
      .createQueryBuilder('c')
      .where('c.productId = :productId', { productId })
      .andWhere('c.isAvailable = true')
      .andWhere('c.deletedAt IS NULL')
      .orderBy('c.price', 'ASC')
      .getOne();

    if (!listing) return { created: 0, skipped: 1 };

    const supplierTenantId = schedule.recommendedSupplierTenantId ?? listing.supplierTenantId;
    const qty              = Math.max(1, eoqQty);

    const rec = await this.recRepo.findOne({
      where: {
        pharmacyTenantId: tenantId,
        productId,
        riskLevel:        'HIGH',
        type:             RecommendationType.REORDER,
        isDismissed:      false,
      },
      order: { createdAt: 'DESC' },
    });

    const expiresAt = new Date(Date.now() + 48 * 3_600_000);

    await this.draftRepo.save(
      this.draftRepo.create({
        pharmacyTenantId: tenantId,
        supplierTenantId,
        productId,
        suggestedQuantity: qty,
        unitPrice:         Number(listing.price),
        currency:          listing.currency,
        urgencyLevel:      'critical',
        recommendationId:  rec?.id ?? null,
        expiresAt,
      }),
    );

    await this.notifyPharmacyAdmins(tenantId, productId, qty);

    return { created: 1, skipped: 0 };
  }

  private async notifyPharmacyAdmins(
    tenantId:  string,
    productId: string,
    qty:       number,
  ): Promise<void> {
    try {
      const tenant  = await this.tenantRepo.findOne({ where: { id: tenantId } });
      const admins  = await this.userRepo.find({ where: { tenantId, role: Role.PHARMACY_ADMIN, isActive: true } });

      await this.notificationSvc.create({
        tenantId,
        type:        'draft_created',
        title:       'Procurement Draft Ready',
        body:        `MediPulse has prepared a reorder draft for ${qty} units. Review and approve in the Procurement Queue.`,
        resourceRef: `product:${productId}`,
        emailSent:   admins.length > 0,
      });

      for (const admin of admins) {
        const { subject, html } = this.emailSvc.buildDraftCreated(
          'your product', qty, 'Selected Supplier',
        );
        await this.emailSvc.send(admin.email, subject, html);
      }
    } catch (err: any) {
      this.logger.error(`Auto-draft notification failed: ${err.message}`);
    }
  }
}


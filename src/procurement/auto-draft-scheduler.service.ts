import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, In } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
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

/**
 * Phase 4 close: auto-draft scheduler.
 *
 * Runs at 6am daily in the worker process.
 * Looks at ProcurementSchedule entries where daysUntilReorderNeeded <= 2.
 * Creates ProcurementDraft for each, notifies pharmacy admin.
 *
 * This closes the automation loop:
 *   Before: pharmacist must manually click "Generate Recommendations"
 *   After:  every morning, drafts are ready in the queue — just approve or reject.
 *
 * Design: idempotent — if a draft already exists for product+pharmacy, skip it.
 */
@Injectable()
export class AutoDraftSchedulerService {
  private readonly logger = new Logger(AutoDraftSchedulerService.name);

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
  ) {}

  @Cron('0 6 * * *')  // 6am daily
  async runDailyDraftGeneration(): Promise<void> {
    this.logger.log('Auto-draft scheduler started');
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

    for (const schedule of urgentSchedules) {
      const { tenantId, productId } = schedule;

      // Skip if pending draft already exists
      const existingDraft = await this.draftRepo.findOne({
        where: { pharmacyTenantId: tenantId, productId, status: 'pending_review' },
      });
      if (existingDraft) { skipped++; continue; }

      // Pick best available supplier from catalog
      const listing = await this.catalogRepo
        .createQueryBuilder('c')
        .where('c.productId = :productId', { productId })
        .andWhere('c.isAvailable = true')
        .andWhere('c.deletedAt IS NULL')
        .orderBy('c.price', 'ASC')
        .getOne();

      if (!listing) { skipped++; continue; }

      // Use recommended supplier from schedule if available
      const supplierTenantId = schedule.recommendedSupplierTenantId ?? listing.supplierTenantId;
      const eoqQty           = schedule.eoqQty ? Math.ceil(Number(schedule.eoqQty)) : 10;

      // Find most recent active HIGH-risk recommendation for this product
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

      const draft = await this.draftRepo.save(
        this.draftRepo.create({
          pharmacyTenantId: tenantId,
          supplierTenantId,
          productId,
          suggestedQuantity: Math.max(1, eoqQty),
          unitPrice:         Number(listing.price),
          currency:          listing.currency,
          urgencyLevel:      'critical',
          recommendationId:  rec?.id ?? null,
          expiresAt,
        }),
      );

      // Notify pharmacy admins
      await this.notifyPharmacyAdmins(tenantId, productId, eoqQty);

      // Emit event for event store + webhooks
      this.emitter.emit(EVENTS.RECOMMENDATION_GENERATED, {
        tenantId,
        recommendationId: draft.id,
        type: 'auto_draft',
        riskLevel: 'HIGH',
        confidence: 0,
      });

      created++;
    }

    this.logger.log(`Auto-draft complete: ${created} created, ${skipped} skipped`);
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

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from '../auth/entities/tenant.entity';
import { TenantType } from '../common/enums/tenant-type.enum';
import { ApprovalService } from '../ai-governance/approval.service';
import { P2pSmartProcurementService } from './p2p-smart-procurement.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';
import { NotificationService } from '../notifications/notification.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

@Injectable()
export class SmartProcurementCron {
  private readonly logger = new Logger(SmartProcurementCron.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly smartProcurement: P2pSmartProcurementService,
    private readonly approvals: ApprovalService,
    private readonly pharmacySettings: PharmacySettingsService,
    private readonly notifications: NotificationService,
    private readonly cronLock: CronLockService,
  ) {}

  /** Daily at 07:15 AM UTC — after the main AI run (06:xx) so inventory is fresh */
  @Cron('15 7 * * *')
  async generateSmartProcurementTasks(): Promise<void> {
    const acquired = await this.cronLock.acquire('smart_procurement_daily');
    if (!acquired) {
      this.logger.log('SmartProcurementCron: skipped (another pod holds the lock)');
      return;
    }

    this.logger.log('SmartProcurementCron: starting daily scan');

    const tenants = await this.tenantRepo.find({ where: { type: TenantType.PHARMACY } });
    let totalCreated = 0;

    for (const tenant of tenants) {
      try {
        totalCreated += await this.scanTenant(tenant.id);
      } catch (err) {
        this.logger.error(`SmartProcurementCron: tenant ${tenant.id} failed — ${(err as Error).message}`);
      }
    }

    this.logger.log(`SmartProcurementCron: done — ${totalCreated} new tasks created`);
  }

  private async scanTenant(tenantId: string): Promise<number> {
    const settings   = await this.pharmacySettings.getSettings(tenantId);
    const aiSettings = settings.aiAnalysisSettings ?? {};

    if (aiSettings.enableSmartProcurement === false) return 0;

    const savingsThreshold = aiSettings.p2pSavingsThreshold ?? 5;
    const maxDistance      = aiSettings.maxP2PDistanceKm ?? 10;
    const minReliability   = aiSettings.minSellerReliabilityScore ?? 70;
    const preferP2P        = aiSettings.preferP2POverSupplier !== false;
    const autoApproveUnder = aiSettings.autoApproveOrdersUnderAmount ?? null;

    const gps = settings.gpsLocation ?? undefined;
    // Pass savingsThreshold into the SQL so the DB filters correctly.
    // Distance filter is applied post-query (not in SQL WHERE).
    const opportunities = await this.smartProcurement.getOpportunities(tenantId, gps, 10, savingsThreshold);

    const filtered = maxDistance != null
      ? opportunities.filter(o => o.distanceKm == null || o.distanceKm <= maxDistance)
      : opportunities;

    let created = 0;

    for (const opp of filtered) {
      // Supplier-fallback items have no p2pListingId — they are informational only,
      // not actionable through the approval queue.
      if (opp.sourceType !== 'p2p' || !opp.p2pListingId) continue;

      try {
        // Skip if a pending/modified approval already exists for this listing
        const existing = await this.approvals.findPendingBySubject(
          tenantId,
          'smart_procurement',
          opp.p2pListingId,
        );
        if (existing) continue;

        const savingsText = opp.savingsPct != null
          ? `أوفر ${opp.savingsPct}% من موردك الحالي`
          : 'سعر تنافسي من البورصة الدوائية';

        const distanceText = opp.distanceKm != null
          ? ` • ${opp.distanceKm.toFixed(1)} كم`
          : '';

        const totalCost = (opp.p2pPrice * opp.currentQty).toFixed(2);

        const priority: 'critical' | 'high' | 'medium' =
          opp.currentQty === 0 ? 'critical'
          : opp.currentQty <= Math.floor(opp.minThreshold * 0.5) ? 'high'
          : 'medium';

        const autoApprove =
          autoApproveUnder !== null &&
          preferP2P &&
          Number(totalCost) <= autoApproveUnder;

        const productLabel = opp.productNameAr ?? opp.productName ?? opp.barcode ?? opp.sku ?? opp.productId.slice(0, 8);
        await this.approvals.create(tenantId, {
          agentCode:   'smart_procurement',
          subjectType: 'smart_procurement',
          subjectId:   opp.p2pListingId,
          title:       `فرصة شراء ذكية: ${productLabel}`,
          summary:     `${savingsText}${distanceText} — متاح ${opp.availableQty} وحدة`,
          rationale:   `مخزونك ${opp.currentQty} وحدة (أقل من الحد الأدنى ${opp.minThreshold}). أفضل عرض متاح من ${opp.sellerName ?? 'صيدلية محلية'} بسعر ${opp.p2pPrice} ج.م/وحدة`,
          confidence:  opp.savingsPct !== null ? Math.min(0.95, 0.7 + opp.savingsPct / 100) : 0.70,
          confidenceReason: opp.savingsPct !== null
            ? `توفير ${opp.savingsPct}% عن سعر الموردين الحاليين`
            : 'سعر مرجعي من البورصة',
          priority,
          expiresAt:   new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          payload: {
            sourceType:      'p2p',
            p2pListingId:    opp.p2pListingId,
            productId:       opp.productId,
            quantity:        Math.min(opp.availableQty, opp.minThreshold * 2),
            agreedPrice:     opp.p2pPrice,
            totalCost:       Number(totalCost),
            sellerName:      opp.sellerName,
            sellerCity:      opp.sellerCity,
            distanceKm:      opp.distanceKm,
            savingsPct:      opp.savingsPct,
            currentQty:      opp.currentQty,
            minThreshold:    opp.minThreshold,
            autoApproved:    autoApprove,
            deepLink:        `/pharmacy/p2p?tab=market&productId=${opp.productId}`,
          },
        });

        created++;
        this.logger.debug(`Created smart_procurement task for listing ${opp.p2pListingId}`);
      } catch (err) {
        this.logger.warn(`Couldn't create task for listing ${opp.p2pListingId}: ${(err as Error).message}`);
      }
    }

    if (created > 0) {
      try {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const alreadySent = await this.notifications.findRecentByType(
          tenantId,
          'p2p_smart_procurement_opportunity',
          todayStart,
        );
        if (!alreadySent && await this.pharmacySettings.getNotifFlag(tenantId, 'enableSmartProcurementAlerts')) {
          await this.notifications.create({
            tenantId,
            type: 'p2p_smart_procurement_opportunity',
            title: `${created} فرصة شراء ذكية جديدة`,
            body: `رصد النظام ${created} فرصة شراء من صيدليات الشبكة بأسعار أفضل من موردّيك الحاليين — تحقق من تبويب "فرص الشراء الذكي"`,
            resourceRef: 'p2p:insights',
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to send procurement notification for ${tenantId}: ${(err as Error).message}`);
      }
    }

    return created;
  }
}

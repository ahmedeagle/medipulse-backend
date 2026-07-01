import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Cron } from '@nestjs/schedule';

import { DrugNeedRequest } from './entities/drug-need-request.entity';
import { ProcurementOrchestrator } from './procurement-orchestrator.service';
import { NotificationService } from '../notifications/notification.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

/**
 * Notify-when-available sweep for "أحتاج دواء".
 *
 * Open needs (no source found at request time) are re-run through the SAME
 * ProcurementOrchestrator on a schedule. The moment a viable source appears the
 * need flips to `sourced` and the pharmacy is notified — closing the demand loop
 * without any manual polling. Also expires stale needs past their TTL.
 *
 * Worker-only (registered in ProcurementWorkerModule). Guarded by a distributed
 * Redis lock so multiple worker replicas never double-sweep.
 */
@Injectable()
export class NeedResourceCronService {
  private readonly logger = new Logger(NeedResourceCronService.name);
  private readonly BATCH = 100;

  constructor(
    @InjectRepository(DrugNeedRequest)
    private readonly needRepo: Repository<DrugNeedRequest>,
    private readonly orchestrator: ProcurementOrchestrator,
    private readonly notifications: NotificationService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('0 */4 * * *') // every 4 hours
  async sweepOpenNeeds(): Promise<void> {
    const locked = await this.cronLock.acquire('need_resource_sweep', 1800);
    if (!locked) {
      this.logger.log('need_resource_sweep skipped — lock held by another worker');
      return;
    }

    try {
      await this.expireStaleNeeds();

      const open = await this.needRepo.find({
        where: { status: 'open', productId: Not(IsNull()) },
        order: { createdAt: 'ASC' },
        take: this.BATCH,
      });

      if (!open.length) {
        this.logger.log('need_resource_sweep: no open needs to re-source');
        return;
      }

      let sourced = 0;
      for (const need of open) {
        try {
          const plan = await this.orchestrator.generatePlan(
            need.pharmacyTenantId,
            need.productId as string,
            need.requestedQty,
            { triggerEvent: 'manual' },
          );
          if (!plan.splits.length) continue;

          const bestUnitPrice = Math.min(...plan.splits.map((s) => s.unitPrice));
          const savedAmt = plan.explainability?.financialImpact?.savedVsHistoricalAvg ?? null;

          need.status = 'sourced';
          need.sourceOptionsCount = plan.splits.length;
          need.resultSnapshot = {
            splits: plan.splits.map((s) => ({
              source: s.source,
              sourceName: s.sourceName,
              qty: s.qty,
              unitPrice: s.unitPrice,
              reliabilityScore: s.reliabilityScore ?? null,
              reason: s.reason,
            })),
            totalCost: plan.totalCost,
            bestUnitPrice,
            insufficientSupply: plan.insufficientSupply,
            confidence: plan.confidence,
            savedVsHistoricalAvg: savedAmt,
            delayReason: plan.delayRecommendation?.humanReason ?? null,
          };
          await this.needRepo.save(need);
          await this.notifyAvailable(need, bestUnitPrice);
          sourced++;
        } catch (err) {
          this.logger.warn(
            `re-source failed for need ${need.id}: ${(err as Error)?.message ?? err}`,
          );
        }
      }

      this.logger.log(`need_resource_sweep: ${sourced}/${open.length} needs became available`);
    } catch (err: any) {
      this.logger.error(`need_resource_sweep failed: ${err?.message}`, err?.stack);
    }
  }

  private async expireStaleNeeds(): Promise<void> {
    const res = await this.needRepo
      .createQueryBuilder()
      .update(DrugNeedRequest)
      .set({ status: 'expired' })
      .where('status = :status', { status: 'open' })
      .andWhere('"expiresAt" IS NOT NULL AND "expiresAt" < :now', { now: new Date() })
      .execute();
    if (res.affected) this.logger.log(`need_resource_sweep: expired ${res.affected} stale need(s)`);
  }

  private async notifyAvailable(need: DrugNeedRequest, bestUnitPrice: number): Promise<void> {
    await this.notifications.create({
      tenantId: need.pharmacyTenantId,
      type: 'p2p_opportunity',
      title: `توفّر الدواء «${need.productName}»`,
      body: `الدواء اللي طلبته بقى متاح — ${need.sourceOptionsCount} مصدر بأفضل سعر ${bestUnitPrice} ج.م. راجع الخيارات من «أحتاج دواء ← طلباتي».`,
      resourceRef: `needId=${need.id}`,
      dedupeWindowMs: 6 * 60 * 60 * 1000,
    });
  }
}

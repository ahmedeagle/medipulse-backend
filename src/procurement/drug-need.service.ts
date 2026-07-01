import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DrugNeedRequest, NeedStatus } from './entities/drug-need-request.entity';
import { CreateDrugNeedDto } from './dto/create-drug-need.dto';
import { ProcurementOrchestrator } from './procurement-orchestrator.service';
import { Product } from '../inventory/entities/product.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { OrchestratorResult } from './procurement-orchestrator.types';
import { NotificationService } from '../notifications/notification.service';
import { DemandBroadcastService } from './demand-broadcast.service';

const NEED_TTL_DAYS = 7;

export interface CreateNeedResult {
  need: DrugNeedRequest;
  plan: OrchestratorResult | null;
}

/**
 * DrugNeedService — the "أحتاج دواء" intake.
 *
 * Unified with the Decision Engine: every need with a resolvable product is run
 * through the SAME ProcurementOrchestrator that powers AI purchase drafts, so the
 * pharmacy instantly sees the best-priced split across distributors + nearby
 * pharmacies. The need row is also a durable DEMAND signal for the future Shortage
 * Radar and notify-when-available.
 */
@Injectable()
export class DrugNeedService {
  private readonly logger = new Logger(DrugNeedService.name);

  constructor(
    @InjectRepository(DrugNeedRequest)
    private readonly needRepo: Repository<DrugNeedRequest>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly orchestrator: ProcurementOrchestrator,
    private readonly notifications: NotificationService,
    private readonly demandBroadcast: DemandBroadcastService,
  ) {}

  async createNeed(tenantId: string, dto: CreateDrugNeedDto): Promise<CreateNeedResult> {
    const productId = dto.productId ?? (await this.resolveProductId(dto.productName));
    const region = await this.resolveRegion(tenantId);

    let plan: OrchestratorResult | null = null;
    let snapshot: Record<string, any> | null = null;
    let sourceOptionsCount = 0;
    let status: NeedStatus = 'open';

    if (productId) {
      try {
        plan = await this.orchestrator.generatePlan(tenantId, productId, dto.requestedQty, {
          triggerEvent: 'manual',
        });
        sourceOptionsCount = plan.splits.length;
        status = sourceOptionsCount > 0 ? 'sourced' : 'open';
        snapshot = this.buildSnapshot(plan);
      } catch (err) {
        // Sourcing failure must NOT drop the demand signal — keep it 'open'.
        this.logger.warn(
          `generatePlan failed for need (tenant=${tenantId} product=${productId}): ${
            (err as Error)?.message ?? err
          }`,
        );
      }
    }

    const expiresAt = new Date(Date.now() + NEED_TTL_DAYS * 24 * 60 * 60 * 1000);

    const need = this.needRepo.create({
      pharmacyTenantId: tenantId,
      productId: productId ?? null,
      productName: dto.productName.trim(),
      requestedQty: dto.requestedQty,
      urgency: dto.urgency ?? 'normal',
      status,
      region,
      sourceOptionsCount,
      resultSnapshot: snapshot,
      expiresAt,
    });

    const saved = await this.needRepo.save(need);
    await this.notifyOutcome(saved);
    // Create supply: broadcast the demand to nearby stock-holding pharmacies
    // (urgent → in-app, critical → in-app + WhatsApp). Never blocks the response.
    this.demandBroadcast.broadcast(saved).catch((err) =>
      this.logger.warn(`demand broadcast failed for need ${saved.id}: ${(err as Error)?.message ?? err}`),
    );
    return { need: saved, plan };
  }

  async listNeeds(tenantId: string, status?: NeedStatus): Promise<DrugNeedRequest[]> {
    const where: Record<string, unknown> = { pharmacyTenantId: tenantId };
    if (status) where.status = status;
    return this.needRepo.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }

  async cancelNeed(tenantId: string, id: string): Promise<DrugNeedRequest> {
    const need = await this.needRepo.findOne({ where: { id, pharmacyTenantId: tenantId } });
    if (!need) throw new NotFoundException('Need request not found');
    need.status = 'cancelled';
    return this.needRepo.save(need);
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  /** Persist an outcome notification so the result also lives in the bell. */
  private async notifyOutcome(need: DrugNeedRequest): Promise<void> {
    try {
      if (need.status === 'sourced') {
        const best = need.resultSnapshot?.bestUnitPrice;
        const savedAmt = need.resultSnapshot?.savedVsHistoricalAvg;
        const savedTxt = savedAmt && savedAmt > 0 ? ` ووفّرنا لك نحو ${Math.round(savedAmt)} ج.م` : '';
        const priceTxt = best != null ? ` بأفضل سعر ${best} ج.م` : '';
        await this.notifications.create({
          tenantId: need.pharmacyTenantId,
          type: 'p2p_opportunity',
          title: `وجدنا مصدر لـ «${need.productName}»`,
          body: `لقينالك ${need.sourceOptionsCount} مصدر للدواء${priceTxt}${savedTxt}. راجع الخيارات من «أحتاج دواء ← طلباتي».`,
          resourceRef: `needId=${need.id}`,
          dedupeWindowMs: 60_000,
        });
      } else if (need.status === 'open') {
        await this.notifications.create({
          tenantId: need.pharmacyTenantId,
          type: 'system',
          title: `سجّلنا طلبك لـ «${need.productName}»`,
          body: 'مفيش مصدر متاح دلوقتي — هنبحث وننبّهك أول ما يتوفّر.',
          resourceRef: `needId=${need.id}`,
          dedupeWindowMs: 60_000,
        });
      }
    } catch (err) {
      this.logger.warn(`notifyOutcome failed for need ${need.id}: ${(err as Error)?.message ?? err}`);
    }
  }

  /** Resolve a typed drug name / barcode to a catalog product id (best match). */
  private async resolveProductId(rawName: string): Promise<string | null> {
    const term = rawName.trim();
    if (!term) return null;

    // Exact barcode wins.
    const byBarcode = await this.productRepo.findOne({ where: { barcode: term } });
    if (byBarcode) return byBarcode.id;

    const like = `%${term.replace(/[%_]/g, '')}%`;
    const match = await this.productRepo
      .createQueryBuilder('p')
      .where('p.name ILIKE :like', { like })
      .orWhere('p."nameAr" ILIKE :like', { like })
      .orWhere('p."genericName" ILIKE :like', { like })
      .orderBy('LENGTH(p.name)', 'ASC')
      .limit(1)
      .getOne();

    return match?.id ?? null;
  }

  private async resolveRegion(tenantId: string): Promise<string | null> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return tenant?.region ?? tenant?.city ?? null;
  }

  private buildSnapshot(plan: OrchestratorResult): Record<string, any> {
    const splits = plan.splits.map((s) => ({
      source: s.source,
      sourceName: s.sourceName,
      qty: s.qty,
      unitPrice: s.unitPrice,
      reliabilityScore: s.reliabilityScore ?? null,
      reason: s.reason,
    }));
    const bestUnitPrice = splits.length
      ? Math.min(...splits.map((s) => s.unitPrice))
      : null;

    return {
      splits,
      totalCost: plan.totalCost,
      bestUnitPrice,
      insufficientSupply: plan.insufficientSupply,
      confidence: plan.confidence,
      savedVsHistoricalAvg: plan.explainability?.financialImpact?.savedVsHistoricalAvg ?? null,
      delayReason: plan.delayRecommendation?.humanReason ?? null,
    };
  }
}

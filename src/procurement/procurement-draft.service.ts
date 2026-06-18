import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProcurementDraft, DraftStatus, UrgencyLevel } from './entities/procurement-draft.entity';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';
import { SupplierReliabilityScore } from '../supplier/entities/supplier-reliability-score.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderStatus } from '../common/enums/order-status.enum';
import { RecommendationType } from '../common/enums/recommendation-type.enum';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';

@Injectable()
export class ProcurementDraftService {
  private readonly logger = new Logger(ProcurementDraftService.name);

  constructor(
    @InjectRepository(ProcurementDraft)
    private readonly draftRepo: Repository<ProcurementDraft>,
    @InjectRepository(AiRecommendation)
    private readonly recRepo: Repository<AiRecommendation>,
    @InjectRepository(SupplierCatalogItem)
    private readonly catalogRepo: Repository<SupplierCatalogItem>,
    @InjectRepository(SupplierReliabilityScore)
    private readonly scoreRepo: Repository<SupplierReliabilityScore>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepo: Repository<OrderItem>,
    private readonly dataSource: DataSource,
    private readonly pharmacySettingsService: PharmacySettingsService,
  ) {}

  // ─── Auto-generate draft from a HIGH-risk recommendation ─────────────────

  async generateFromRecommendation(
    recommendationId: string,
    tenantId: string,
  ): Promise<ProcurementDraft | null> {
    const rec = await this.recRepo.findOne({
      where: { id: recommendationId, pharmacyTenantId: tenantId },
      relations: ['product'],
    });

    if (!rec || rec.type !== RecommendationType.REORDER || rec.riskLevel !== 'HIGH') {
      return null;
    }

    // Check no active draft already exists for this product + tenant
    const existing = await this.draftRepo.findOne({
      where: {
        pharmacyTenantId: tenantId,
        productId: rec.productId,
        status: In(['pending_review'] as DraftStatus[]),
      },
    });
    if (existing) return existing;

    // Pick best supplier: highest reliability score, then lowest price
    const listings = await this.catalogRepo
      .createQueryBuilder('c')
      .where('c.productId = :productId', { productId: rec.productId })
      .andWhere('c.isAvailable = true')
      .andWhere('c.deletedAt IS NULL')
      .getMany();

    if (!listings.length) return null;

    const scores = await this.scoreRepo.find({
      where: { supplierTenantId: In(listings.map((l) => l.supplierTenantId)) },
    });
    const scoreMap = new Map(scores.map((s) => [s.supplierTenantId, Number(s.overallScore)]));

    const bestListing = listings.reduce((best, l) => {
      if (!best) return l;
      const bestScore = scoreMap.get(best.supplierTenantId) ?? 0;
      const thisScore = scoreMap.get(l.supplierTenantId) ?? 0;
      if (thisScore !== bestScore) return thisScore > bestScore ? l : best;
      return Number(l.price) < Number(best.price) ? l : best;
    }, null as SupplierCatalogItem | null);

    const suggestedQty = rec.payload?.suggestedReorderQty ?? rec.payload?.deficit ?? 10;
    const urgencyLevel: UrgencyLevel =
      rec.riskLevel === 'HIGH' ? 'critical' : rec.riskLevel === 'MEDIUM' ? 'high' : 'medium';
    const expiresAt = new Date(Date.now() + 48 * 3_600_000);

    const draft = this.draftRepo.create({
      pharmacyTenantId: tenantId,
      supplierTenantId: bestListing.supplierTenantId,
      productId: rec.productId,
      suggestedQuantity: Math.max(1, Math.round(suggestedQty)),
      unitPrice: Number(bestListing.price),
      currency: bestListing.currency,
      urgencyLevel,
      recommendationId,
      expiresAt,
    });

    return this.draftRepo.save(draft);
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async findPending(pharmacyTenantId: string): Promise<ProcurementDraft[]> {
    return this.draftRepo
      .createQueryBuilder('d')
      .where('d.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
      .andWhere('d.status = :status', { status: 'pending_review' })
      .andWhere('d.expiresAt > NOW()')
      .orderBy("CASE d.urgencyLevel WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END", 'ASC')
      .addOrderBy('d.createdAt', 'ASC')
      .getMany();
  }

  // ─── Smart Procurement Queue (3B) ─────────────────────────────────────────

  async getProcurementQueue(pharmacyTenantId: string): Promise<{
    criticalDrafts: ProcurementDraft[];
    expiringStock: InventoryItem[];
    pendingOrders: Order[];
  }> {
    const settings = await this.pharmacySettingsService.getSettings(pharmacyTenantId);
    const alertDays = settings.inventorySettings?.expiryAlertDays ?? 90;

    const [criticalDrafts, expiringStock, pendingOrders] = await Promise.all([
      this.findPending(pharmacyTenantId),
      this.inventoryRepo
        .createQueryBuilder('i')
        .leftJoinAndSelect('i.product', 'p')
        .where('i.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
        .andWhere('i.deletedAt IS NULL')
        .andWhere('i.expiryDate IS NOT NULL')
        .andWhere(`i.expiryDate <= NOW() + INTERVAL '${alertDays} days'`)
        .andWhere('i.expiryDate > NOW()')
        .orderBy('i.expiryDate', 'ASC')
        .getMany(),
      this.orderRepo
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.items', 'items')
        .leftJoinAndSelect('items.product', 'product')
        .where('o.pharmacyTenantId = :pharmacyTenantId', { pharmacyTenantId })
        .andWhere('o.status IN (:...statuses)', {
          statuses: [OrderStatus.SUBMITTED, OrderStatus.ACCEPTED, OrderStatus.SHIPPED],
        })
        .orderBy('o.createdAt', 'ASC')
        .getMany(),
    ]);

    return { criticalDrafts, expiringStock, pendingOrders };
  }

  // ─── Approve ──────────────────────────────────────────────────────────────

  async approveDraft(pharmacyTenantId: string, draftId: string): Promise<Order> {
    const draft = await this.findOwned(pharmacyTenantId, draftId);

    if (draft.status !== 'pending_review') {
      throw new BadRequestException(`Draft is already ${draft.status}`);
    }
    if (draft.expiresAt < new Date()) {
      throw new BadRequestException('Draft has expired — generate a new recommendation');
    }

    // Verify supplier still has product available with sufficient stock
    const listing = await this.catalogRepo.findOne({
      where: {
        supplierTenantId: draft.supplierTenantId,
        productId: draft.productId,
        isAvailable: true,
      },
    });
    if (!listing) {
      throw new BadRequestException('Supplier product is no longer available — reject this draft');
    }

    // Explicit stock check — isAvailable=true does not guarantee sufficient stock
    if (listing.stock > 0 && Number(listing.stock) < draft.suggestedQuantity) {
      throw new BadRequestException(
        `Insufficient supplier stock. Available: ${listing.stock} units, draft requests: ${draft.suggestedQuantity} units. ` +
        `Reject this draft and generate a new recommendation.`,
      );
    }

    const unitPrice      = Number(listing.price);
    const subtotalAmount = unitPrice * draft.suggestedQuantity;
    const vatRate        = 0.15;
    const vatAmount      = Math.round(subtotalAmount * vatRate * 100) / 100;
    const totalAmount    = Math.round((subtotalAmount + vatAmount) * 100) / 100;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const order = qr.manager.create(Order, {
        pharmacyTenantId,
        supplierTenantId:  draft.supplierTenantId,
        currency:          'SAR',
        subtotalAmount,
        vatRate,
        vatAmount,
        totalAmount,
        status:            OrderStatus.SUBMITTED,
        notes:             `Auto-generated from procurement draft ${draft.id}`,
      });
      const savedOrder = await qr.manager.save(Order, order);

      await qr.manager.save(
        OrderItem,
        qr.manager.create(OrderItem, {
          orderId: savedOrder.id,
          productId: draft.productId,
          quantity: draft.suggestedQuantity,
          unitPrice,
          totalPrice: totalAmount,
        }),
      );

      await qr.manager.update(ProcurementDraft, draftId, {
        status: 'converted_to_order',
        convertedOrderId: savedOrder.id,
      });

      await qr.commitTransaction();

      this.logger.log(`Draft ${draftId} approved → order ${savedOrder.id}`);
      return this.orderRepo.findOne({
        where: { id: savedOrder.id },
        relations: ['items', 'items.product', 'pharmacyTenant', 'supplierTenant'],
      });
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  // ─── Reject ───────────────────────────────────────────────────────────────

  async rejectDraft(pharmacyTenantId: string, draftId: string, reason?: string): Promise<ProcurementDraft> {
    const draft = await this.findOwned(pharmacyTenantId, draftId);
    if (draft.status !== 'pending_review') {
      throw new BadRequestException(`Draft is already ${draft.status}`);
    }
    await this.draftRepo.update(draftId, { status: 'rejected', rejectionReason: reason ?? null });
    return this.draftRepo.findOne({ where: { id: draftId } });
  }

  // ─── Scheduled expiry — runs daily at 4am ─────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async expireStaleDrafts(): Promise<void> {
    const result = await this.draftRepo.update(
      { status: 'pending_review', expiresAt: LessThan(new Date()) },
      { status: 'expired' },
    );
    if (result.affected) {
      this.logger.log(`Expired ${result.affected} stale procurement drafts`);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async findOwned(pharmacyTenantId: string, draftId: string): Promise<ProcurementDraft> {
    const draft = await this.draftRepo.findOne({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    if (draft.pharmacyTenantId !== pharmacyTenantId) throw new ForbiddenException('Access denied');
    return draft;
  }
}

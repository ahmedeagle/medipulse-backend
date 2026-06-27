import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import {
  CatalogRequest,
  CatalogRequestStatus,
  CatalogRequestTimelineEntry,
} from './entities/catalog-request.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Product } from '../inventory/entities/product.entity';
import {
  CreateCatalogRequestDto,
  UpdateCatalogRequestDto,
  BulkCreateCatalogRequestDto,
  BulkUpdateCatalogRequestDto,
} from './dto/catalog-request.dto';

const VALID_TRANSITIONS: Record<CatalogRequestStatus, CatalogRequestStatus[]> = {
  submitted:    ['under_review', 'need_info', 'approved', 'rejected', 'closed'],
  under_review: ['need_info', 'approved', 'rejected', 'closed'],
  need_info:    ['under_review', 'approved', 'rejected', 'closed'],
  approved:     ['closed'],
  rejected:     ['closed'],
  closed:       [],
};

@Injectable()
export class CatalogRequestsService {
  constructor(
    @InjectRepository(CatalogRequest)
    private readonly repo: Repository<CatalogRequest>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly dataSource: DataSource,
  ) {}

  /** Generate a short, human-readable, collision-resistant tracking number. */
  private async nextTrackingNumber(): Promise<string> {
    // 4 random bytes → 8 hex chars, then take 6 → ~16M space; retry on rare collision.
    for (let i = 0; i < 5; i++) {
      const candidate = `REQ-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
      const exists = await this.repo.exist({ where: { trackingNumber: candidate } });
      if (!exists) return candidate;
    }
    // Fallback to fully unique long form.
    return `REQ-${randomBytes(6).toString('hex').toUpperCase()}`;
  }

  // ── Pharmacy-side ────────────────────────────────────────────────────────

  async createForPharmacy(
    tenantId: string,
    userId: string,
    dto: CreateCatalogRequestDto,
  ): Promise<CatalogRequest> {
    if (!dto.name?.trim() && !dto.nameAr?.trim() && !dto.barcode?.trim()) {
      throw new BadRequestException(
        'At least one of: name, nameAr, or barcode must be provided',
      );
    }

    let inventoryItemId: string | null = null;
    if (dto.inventoryItemId) {
      const item = await this.inventoryRepo.findOne({ where: { id: dto.inventoryItemId } });
      if (!item) throw new NotFoundException('Inventory item not found');
      if (item.pharmacyTenantId !== tenantId) {
        throw new ForbiddenException('You do not have access to this inventory item');
      }
      inventoryItemId = item.id;

      // Prevent duplicate open requests for the same inventory item.
      // Pharmacies frequently click "request review" multiple times — flooding
      // the admin queue helps no one. Any open (non-terminal) request blocks
      // a new submission and returns the existing tracking number.
      const existingOpen = await this.repo.findOne({
        where: {
          inventoryItemId,
          status: In(['submitted', 'under_review', 'need_info'] as CatalogRequestStatus[]),
        },
        order: { createdAt: 'DESC' },
      });
      if (existingOpen) {
        throw new ConflictException({
          message: `يوجد طلب مراجعة مفتوح بالفعل لهذا المنتج (رقم التتبّع: ${existingOpen.trackingNumber}). انتظر قرار فريق الكتالوج قبل إرسال طلب جديد.`,
          code: 'DUPLICATE_OPEN_REQUEST',
          existingRequest: {
            id: existingOpen.id,
            trackingNumber: existingOpen.trackingNumber,
            status: existingOpen.status,
            createdAt: existingOpen.createdAt,
          },
        });
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const trackingNumber = await this.nextTrackingNumber();
      const now = new Date().toISOString();

      const entry: CatalogRequestTimelineEntry = {
        at: now,
        actor: 'pharmacy',
        actorId: userId,
        event: 'submitted',
        note: dto.notes?.trim() || undefined,
      };

      const req = manager.getRepository(CatalogRequest).create({
        trackingNumber,
        pharmacyTenantId: tenantId,
        inventoryItemId,
        createdByUserId: userId,
        type: dto.type || 'add',
        status: 'submitted',
        payload: {
          name:         dto.name?.trim(),
          nameAr:       dto.nameAr?.trim(),
          barcode:      dto.barcode?.trim(),
          manufacturer: dto.manufacturer?.trim(),
          dosageForm:   dto.dosageForm?.trim(),
          strength:     dto.strength?.trim(),
          imageUrl:     dto.imageUrl?.trim(),
          notes:        dto.notes?.trim(),
        },
        timeline: [entry],
      });
      const saved = await manager.getRepository(CatalogRequest).save(req);

      // Flip the inventory item to "pending" so the badge reflects the request.
      if (inventoryItemId) {
        await manager.getRepository(InventoryItem).update(inventoryItemId, {
          linkStatus: 'pending',
        });
      }

      // Auto-approve when we can prove a confident match (barcode hit).
      // This is the migration unblocker: pharmacies bulk-submit hundreds
      // of unmatched rows; the ones whose barcode already exists in the
      // catalog skip the admin queue entirely.
      const autoApproved = await this.tryAutoApprove(manager, saved);
      return autoApproved ?? saved;
    });
  }

  async listForPharmacy(tenantId: string): Promise<CatalogRequest[]> {
    return this.repo.find({
      where: { pharmacyTenantId: tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async getByTrackingForPharmacy(
    tenantId: string,
    tracking: string,
  ): Promise<CatalogRequest> {
    const req = await this.repo.findOne({ where: { trackingNumber: tracking } });
    if (!req) throw new NotFoundException('Catalog request not found');
    if (req.pharmacyTenantId !== tenantId) {
      throw new ForbiddenException('You do not have access to this request');
    }
    return req;
  }

  // ── Admin-side ───────────────────────────────────────────────────────────

  async listForAdmin(filter?: { status?: CatalogRequestStatus }): Promise<CatalogRequest[]> {
    const qb = this.repo.createQueryBuilder('r').orderBy('r.createdAt', 'DESC');
    if (filter?.status) qb.andWhere('r.status = :s', { s: filter.status });
    return qb.getMany();
  }

  async updateAsAdmin(
    adminUserId: string,
    requestId: string,
    dto: UpdateCatalogRequestDto,
  ): Promise<CatalogRequest> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CatalogRequest);
      const itemRepo = manager.getRepository(InventoryItem);

      const req = await repo.findOne({ where: { id: requestId } });
      if (!req) throw new NotFoundException('Catalog request not found');

      const nextStatus = dto.status ?? req.status;
      if (nextStatus !== req.status) {
        const allowed = VALID_TRANSITIONS[req.status] || [];
        if (!allowed.includes(nextStatus)) {
          throw new BadRequestException(
            `Invalid status transition: ${req.status} → ${nextStatus}`,
          );
        }
      }

      // If approving, we expect resolvedCatalogProductId to be set so we can
      // re-link the inventory row to a real Product.
      if (nextStatus === 'approved') {
        if (!dto.resolvedCatalogProductId && !req.resolvedCatalogProductId) {
          throw new BadRequestException(
            'resolvedCatalogProductId is required to approve a request',
          );
        }
        const productId = dto.resolvedCatalogProductId ?? req.resolvedCatalogProductId!;
        const product = await this.productRepo.findOne({ where: { id: productId } });
        if (!product) throw new BadRequestException('Resolved catalog product not found');
      }

      if (nextStatus === 'rejected' && !dto.rejectionReason && !req.rejectionReason) {
        throw new BadRequestException('rejectionReason is required to reject a request');
      }

      // Apply patch.
      req.status = nextStatus;
      if (dto.adminNotes !== undefined) req.adminNotes = dto.adminNotes;
      if (dto.rejectionReason !== undefined) req.rejectionReason = dto.rejectionReason;
      if (dto.resolvedCatalogProductId !== undefined) {
        req.resolvedCatalogProductId = dto.resolvedCatalogProductId;
      }
      req.adminUserId = adminUserId;

      if (['approved', 'rejected', 'closed'].includes(nextStatus)) {
        req.adminDecision =
          nextStatus === 'closed' ? 'closed'
          : nextStatus === 'approved' ? 'approved'
          : 'rejected';
        if (!req.resolvedAt) req.resolvedAt = new Date();
      }

      const entry: CatalogRequestTimelineEntry = {
        at: new Date().toISOString(),
        actor: 'admin',
        actorId: adminUserId,
        event: nextStatus,
        note:
          dto.adminNotes?.trim() ||
          dto.rejectionReason?.trim() ||
          undefined,
      };
      req.timeline = [...(req.timeline || []), entry];

      const saved = await repo.save(req);

      // Side-effects on the linked inventory row.
      if (req.inventoryItemId) {
        if (nextStatus === 'approved' && req.resolvedCatalogProductId) {
          await itemRepo.update(req.inventoryItemId, {
            productId: req.resolvedCatalogProductId,
            linkStatus: 'linked',
            matchScore: 100,
            matchExplanation: {
              signals: ['admin_approved_request'],
              requestId: req.id,
            } as any,
            lastLinkedAt: new Date(),
          });
        } else if (nextStatus === 'rejected') {
          await itemRepo.update(req.inventoryItemId, { linkStatus: 'unlinked' });
        }
      }

      return saved;
    });
  }

  // ── Bulk APIs (migration / onboarding) ───────────────────────────────────

  /**
   * Submit many requests in one call. Used during data migration when a
   * pharmacy uploads hundreds of unmatched SKUs from their legacy ERP.
   *
   * Each line is processed independently — duplicates and validation
   * errors do NOT abort the rest of the batch; they're returned in the
   * `failed` array so the UI can surface row-level issues.
   */
  async bulkCreateForPharmacy(
    tenantId: string,
    userId: string,
    dto: BulkCreateCatalogRequestDto,
  ): Promise<{
    submitted: Array<{ index: number; trackingNumber: string; status: CatalogRequestStatus }>;
    failed:    Array<{ index: number; reason: string; code?: string }>;
  }> {
    const submitted: Array<{ index: number; trackingNumber: string; status: CatalogRequestStatus }> = [];
    const failed: Array<{ index: number; reason: string; code?: string }> = [];

    for (let i = 0; i < dto.items.length; i++) {
      const item = dto.items[i];
      try {
        const merged: CreateCatalogRequestDto = {
          ...item,
          notes: dto.batchNote
            ? `${dto.batchNote}${item.notes ? ` — ${item.notes}` : ''}`
            : item.notes,
        };
        const saved = await this.createForPharmacy(tenantId, userId, merged);
        submitted.push({
          index: i,
          trackingNumber: saved.trackingNumber,
          status: saved.status,
        });
      } catch (err: any) {
        failed.push({
          index: i,
          reason: err?.response?.message ?? err?.message ?? 'unknown error',
          code: err?.response?.code,
        });
      }
    }

    return { submitted, failed };
  }

  /**
   * Admin-side bulk decision. Calls `updateAsAdmin` per id and aggregates
   * results. Failures (invalid transition, missing rejectionReason, etc.)
   * are collected per id so the admin sees which rows still need attention.
   */
  async bulkUpdateAsAdmin(
    adminUserId: string,
    dto: BulkUpdateCatalogRequestDto,
  ): Promise<{
    succeeded: string[];
    failed:    Array<{ id: string; reason: string }>;
  }> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of dto.ids) {
      try {
        await this.updateAsAdmin(adminUserId, id, {
          status: dto.status,
          adminNotes: dto.adminNotes,
          rejectionReason: dto.rejectionReason,
        });
        succeeded.push(id);
      } catch (err: any) {
        failed.push({
          id,
          reason: err?.response?.message ?? err?.message ?? 'unknown error',
        });
      }
    }

    return { succeeded, failed };
  }

  /**
   * Best-effort auto-approval. If the request includes a barcode and that
   * barcode already exists on a Product, we link the inventory row and
   * close the request immediately — no admin time needed. Returns null
   * when no confident match was found.
   *
   * Kept conservative: barcode-only match. Name-similarity matching is
   * already handled by the migration-assistant before a request is even
   * filed, so by the time we get here a barcode is the only signal we
   * trust enough to skip human review.
   */
  private async tryAutoApprove(
    manager: import('typeorm').EntityManager,
    request: CatalogRequest,
  ): Promise<CatalogRequest | null> {
    const barcode = request.payload?.barcode?.trim();
    if (!barcode) return null;

    const product = await manager.getRepository(Product).findOne({
      where: { barcode },
      select: ['id'] as any,
    });
    if (!product) return null;

    request.status = 'approved';
    request.adminDecision = 'approved';
    request.resolvedCatalogProductId = product.id;
    request.resolvedAt = new Date();
    request.timeline = [
      ...(request.timeline || []),
      {
        at: new Date().toISOString(),
        actor: 'system',
        event: 'approved',
        note: `auto-approved: barcode ${barcode} matched existing product`,
      },
    ];

    const saved = await manager.getRepository(CatalogRequest).save(request);
    if (saved.inventoryItemId) {
      await manager.getRepository(InventoryItem).update(saved.inventoryItemId, {
        productId: product.id,
        linkStatus: 'linked',
        matchScore: 100,
        lastLinkedAt: new Date(),
      });
    }
    return saved;
  }
}

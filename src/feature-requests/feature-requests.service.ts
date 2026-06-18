import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';

import { FeatureRequest, FeatureRequestStatus } from './entities/feature-request.entity';
import { CreateFeatureRequestDto, UpdateFeatureRequestDto } from './dto/feature-request.dto';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class FeatureRequestsService {
  private readonly logger = new Logger(FeatureRequestsService.name);

  constructor(
    @InjectRepository(FeatureRequest)
    private readonly repo: Repository<FeatureRequest>,
    private readonly notifications: NotificationService,
  ) {}

  // ── Create ──────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    userId: string | null,
    dto: CreateFeatureRequestDto,
  ): Promise<FeatureRequest> {
    // Dedup: if an open/in-progress request already exists for this tenant+question
    // (normalised to lowercase, trimmed), return the existing one.
    const normQ = dto.question.trim().toLowerCase();
    const existing = await this.repo
      .createQueryBuilder('fr')
      .where('fr.tenantId = :tenantId', { tenantId })
      .andWhere('fr.status IN (:...statuses)', { statuses: ['open', 'in_progress'] as FeatureRequestStatus[] })
      .andWhere('LOWER(TRIM(fr.question)) = :q', { q: normQ })
      .getOne();

    if (existing) {
      throw new ConflictException({
        message: `سؤالك مُسجَّل بالفعل ✓ — رقم المتابعة: ${existing.trackingNumber}`,
        code: 'DUPLICATE_OPEN_REQUEST',
        trackingNumber: existing.trackingNumber,
        id: existing.id,
      });
    }

    const trackingNumber = await this.nextTrackingNumber();
    const req = this.repo.create({
      trackingNumber,
      tenantId,
      submittedByUserId: userId,
      question: dto.question.trim(),
      hint:     dto.hint?.trim() ?? null,
      priority: (dto.priority as any) ?? 'medium',
      status:   'open',
    });

    const saved = await this.repo.save(req);
    this.logger.log(JSON.stringify({ event: 'feature_request.created', id: saved.id, trackingNumber, tenantId }));
    return saved;
  }

  // ── List (pharmacy — own requests) ──────────────────────────────────────────

  async listForTenant(tenantId: string): Promise<FeatureRequest[]> {
    return this.repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  // ── List (admin — all requests) ─────────────────────────────────────────────

  async listAll(filter?: { status?: string; assignedToUserId?: string }): Promise<FeatureRequest[]> {
    const qb = this.repo.createQueryBuilder('fr').orderBy('fr.createdAt', 'DESC').take(200);

    if (filter?.status) {
      qb.andWhere('fr.status = :status', { status: filter.status });
    }
    if (filter?.assignedToUserId) {
      qb.andWhere('fr.assignedToUserId = :uid', { uid: filter.assignedToUserId });
    }

    return qb.getMany();
  }

  // ── Update (admin) ───────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateFeatureRequestDto): Promise<FeatureRequest> {
    const req = await this.repo.findOne({ where: { id } });
    if (!req) throw new NotFoundException(`Feature request ${id} not found`);

    const prevStatus = req.status;

    if (dto.status)            req.status           = dto.status as FeatureRequestStatus;
    if (dto.assignedToUserId !== undefined) req.assignedToUserId = dto.assignedToUserId ?? null;
    if (dto.resolution)        req.resolution       = dto.resolution.trim();
    if (dto.priority)          req.priority         = dto.priority as any;

    if (req.status === 'resolved' && !req.resolvedAt) {
      req.resolvedAt = new Date();
    }

    const saved = await this.repo.save(req);

    // Fire in-app notification when status changes to in_progress or resolved
    if (dto.status && dto.status !== prevStatus) {
      await this.fireStatusNotification(saved);
    }

    this.logger.log(JSON.stringify({
      event: 'feature_request.updated', id, prevStatus, newStatus: saved.status,
    }));

    return saved;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async fireStatusNotification(req: FeatureRequest): Promise<void> {
    if (req.status !== 'in_progress' && req.status !== 'resolved') return;

    const isResolved = req.status === 'resolved';
    try {
      await this.notifications.create({
        tenantId:    req.tenantId,
        userId:      req.submittedByUserId ?? undefined,
        type:        'feature_request_update',
        title:       isResolved ? 'تم تهيئة الميزة المطلوبة 🎉' : 'طلبك قيد المراجعة',
        body:        isResolved
          ? `طلبك ${req.trackingNumber} تمت تهيئته — يمكنك الآن تجربة السؤال في المساعد الذكي`
          : `طلبك ${req.trackingNumber} قيد المراجعة من فريق GX1`,
        resourceRef: `feature-request:${req.id}`,
      });
    } catch (err) {
      this.logger.warn({ event: 'feature_request.notify_failed', id: req.id, err: String(err) });
    }
  }

  private async nextTrackingNumber(): Promise<string> {
    // 4 random bytes → 8 hex chars, take first 6 → ~16M space; retry on collision.
    for (let i = 0; i < 5; i++) {
      const candidate = `FEAT-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
      const clash = await this.repo.findOne({ where: { trackingNumber: candidate } });
      if (!clash) return candidate;
    }
    // Fallback: 6 random bytes (12 hex) virtually eliminates collision
    return `FEAT-${randomBytes(6).toString('hex').toUpperCase()}`;
  }
}

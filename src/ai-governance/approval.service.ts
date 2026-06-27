import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Approval, ApprovalStatus } from './entities/approval.entity';
import {
  ApprovalEvent,
  ApprovalActorType,
} from './entities/approval-event.entity';
import { AgentDefinition } from './entities/agent-definition.entity';
import { AgentTenantSetting } from './entities/agent-tenant-setting.entity';
import { CreateApprovalDto, ListApprovalsQueryDto } from './dto/approval.dto';

/**
 * Valid state transitions for the approval lifecycle (PRD §11).
 *
 *   pending  → modified | approved | rejected | expired
 *   modified → approved | rejected | expired
 *   approved → executed
 *   rejected, executed, expired → (terminal)
 */
const ALLOWED_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  pending:  ['modified', 'approved', 'rejected', 'expired'],
  modified: ['approved', 'rejected', 'expired', 'modified'],
  approved: ['executed'],
  rejected: [],
  executed: [],
  expired:  [],
};

const CONFIDENCE_LABEL = (c: number): Approval['confidenceLabel'] => {
  if (c >= 0.9) return 'very_high';
  if (c >= 0.75) return 'high';
  if (c >= 0.5) return 'medium';
  return 'low';
};

export interface ApprovalActor {
  userId?: string | null;
  type: ApprovalActorType;
}

/**
 * The single execution gate for every AI-suggested action (PRD §11).
 *
 * Responsibilities:
 *   - Enforce the 4-state machine (no illegal transitions).
 *   - Honor the per-tenant agent enablement + minConfidence override before
 *     creating any approval — drops sub-threshold suggestions silently so
 *     the queue never becomes noisy.
 *   - Write one append-only `approval_events` row on every transition so the
 *     UI's "decision history" tab can render the full chain from one query.
 *   - Preserve the AI's originalPayload the first time a user modifies it,
 *     producing the regulator-grade "AI proposed X, human approved Y" trail.
 *
 * Side-effect execution (e.g. "approved → create purchase order") is left to
 * domain services; this service only stamps `executed` + `executionResult`
 * on confirmation. That keeps governance independent of every downstream
 * action, exactly like ServiceNow's approval engine works.
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    @InjectRepository(Approval)            private readonly repo: Repository<Approval>,
    @InjectRepository(ApprovalEvent)       private readonly events: Repository<ApprovalEvent>,
    @InjectRepository(AgentDefinition)     private readonly agents: Repository<AgentDefinition>,
    @InjectRepository(AgentTenantSetting)  private readonly settings: Repository<AgentTenantSetting>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── creation ─────────────────────────────────────────────────────────────

  /**
   * Create a new approval. Called by agent processors (Inventory Expert,
   * Purchase Expert, …) — never by HTTP clients directly.
   *
   * Returns `null` (not an error) if the agent is disabled for this tenant
   * or the confidence falls below the effective threshold. This lets agent
   * code do `await approvals.create(...)` without branching.
   *
   * Central deduplication: when `dto.needKey` is provided, only ONE pending
   * approval may exist per (tenantId, needKey). If another agent already
   * raised an approval for the same business need, this call merges itself
   * as an *alternative action* on the existing card instead of producing a
   * duplicate row. This is the single chokepoint that prevents the same
   * product from showing up as 3 tasks (low_stock + risk recommendation +
   * dead_stock + …) — each agent stays simple, the queue stays clean.
   */
  async create(
    tenantId: string,
    dto: CreateApprovalDto,
  ): Promise<Approval | null> {
    const def = await this.agents.findOne({ where: { code: dto.agentCode } });
    if (!def) {
      throw new BadRequestException(`Unknown agent code: ${dto.agentCode}`);
    }

    const setting = await this.settings.findOne({
      where: { tenantId, agentCode: dto.agentCode },
    });
    const enabled = setting?.enabled ?? def.defaultEnabled;
    if (!enabled) return null;

    const minConf = setting?.minConfidence ?? def.minConfidence;
    const conf = dto.confidence ?? 0;
    if (conf > 0 && conf < Number(minConf)) {
      // Sub-threshold suggestion → silently drop. The agent ran, but the
      // human queue stays clean. This is the noise-suppression contract.
      return null;
    }

    // ── Central dedup on needKey ────────────────────────────────────────
    // Only a SELECT on the partial unique index (tenantId, needKey WHERE
    // status IN pending/modified) — O(1) regardless of approval volume.
    if (dto.needKey) {
      const existing = await this.repo
        .createQueryBuilder('a')
        .where('a.tenantId = :tenantId',  { tenantId })
        .andWhere('a.needKey = :needKey', { needKey: dto.needKey })
        .andWhere(`a.status IN ('pending','modified')`)
        .getOne();

      if (existing) {
        // Same need, second voice: fold the new proposal into
        // `payload.alternatives[]` on the existing card. Up to 4 alternatives
        // are kept; older ones win because users were already considering
        // them, and unbounded growth would bloat the payload.
        const alt = {
          agentCode:   dto.agentCode,
          subjectType: dto.subjectType,
          subjectId:   dto.subjectId,
          title:       dto.title,
          summary:     dto.summary,
          rationale:   dto.rationale,
          confidence:  conf,
          payload:     dto.payload ?? {},
          mergedAt:    new Date().toISOString(),
        };
        const existingAlts = Array.isArray(existing.payload?.alternatives)
          ? existing.payload!.alternatives
          : [];
        // Skip if the same agent already contributed an alternative for this
        // need — idempotent under cron retries.
        const alreadyMerged =
          existing.createdByAgent === dto.agentCode ||
          existingAlts.some((x: any) => x?.agentCode === dto.agentCode);
        if (alreadyMerged) return existing;

        const mergedPayload = {
          ...(existing.payload ?? {}),
          alternatives: [...existingAlts, alt].slice(0, 4),
        };

        // Priority is the strongest signal anyone raised. We only bump up,
        // never down — a critical alternative must light up the card.
        const rank: Record<string, number> = {
          critical: 3, high: 2, medium: 1, low: 0,
        };
        const newPriority =
          rank[dto.priority ?? 'medium'] > rank[existing.priority]
            ? dto.priority!
            : existing.priority;

        await this.repo.update(existing.id, {
          payload:  mergedPayload,
          priority: newPriority,
        });
        return { ...existing, payload: mergedPayload, priority: newPriority };
      }
    }

    const approval = this.repo.create({
      tenantId,
      agentCode:       dto.agentCode,
      subjectType:     dto.subjectType,
      subjectId:       dto.subjectId,
      title:           dto.title,
      summary:         dto.summary,
      rationale:       dto.rationale,
      confidence:      conf,
      confidenceLabel: CONFIDENCE_LABEL(conf),
      confidenceReason: dto.confidenceReason ?? null,
      priority:        dto.priority ?? 'medium',
      status:          'pending',
      payload:         dto.payload ?? {},
      originalPayload: null,
      createdByAgent:  dto.agentCode,
      needKey:         dto.needKey ?? null,
      expiresAt:       dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    const saved = await this.repo.save(approval);
    await this.recordEvent(saved, null, 'pending', { type: 'agent' });
    return saved;
  }

  // ── queries ──────────────────────────────────────────────────────────────

  async list(tenantId: string, q: ListApprovalsQueryDto) {
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.tenantId = :tenantId', { tenantId })
      .orderBy(`
        CASE a.priority
          WHEN 'critical' THEN 0
          WHEN 'high'     THEN 1
          WHEN 'medium'   THEN 2
          WHEN 'low'      THEN 3
        END
      `, 'ASC')
      .addOrderBy('a.createdAt', 'DESC')
      .take(q.limit ?? 25)
      .skip(q.offset ?? 0);

    if (q.status)      qb.andWhere('a.status = :s',      { s: q.status });
    if (q.agentCode)   qb.andWhere('a.agentCode = :ac',  { ac: q.agentCode });
    if (q.subjectType) qb.andWhere('a.subjectType = :st',{ st: q.subjectType });
    if (q.priority)    qb.andWhere('a.priority = :p',    { p: q.priority });

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getOne(tenantId: string, id: string): Promise<Approval> {
    const a = await this.repo.findOne({ where: { id, tenantId } });
    if (!a) throw new NotFoundException(`Approval ${id} not found`);
    return a;
  }

  /** Returns the first non-terminal approval for a given (subjectType, subjectId) pair. */
  async findPendingBySubject(
    tenantId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<Approval | null> {
    return this.repo.findOne({
      where: { tenantId, subjectType, subjectId, status: 'pending' },
    });
  }

  async getEvents(tenantId: string, id: string): Promise<ApprovalEvent[]> {
    await this.getOne(tenantId, id); // tenant-scope guard
    return this.events.find({
      where: { approvalId: id },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Tenant-wide audit feed (newest first) for the AI Center Audit tab.
   *
   * Enriched with the approval's title + subjectType so auditors can read
   * "WHO did WHAT on WHICH item" in a single row, without N+1 queries.
   */
  async tenantEvents(tenantId: string, limit: number, offset: number) {
    const [rawEvents, total] = await this.events.findAndCount({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const approvalIds = Array.from(new Set(rawEvents.map(e => e.approvalId)));
    const approvals = approvalIds.length
      ? await this.repo.find({
          where: { id: In(approvalIds) },
          select: ['id', 'title', 'subjectType', 'subjectId', 'priority'],
        })
      : [];
    const byId = new Map(approvals.map(a => [a.id, a]));

    const data = rawEvents.map(ev => {
      const a = byId.get(ev.approvalId);
      return {
        ...ev,
        approvalTitle:       a?.title       ?? null,
        approvalSubjectType: a?.subjectType ?? null,
        approvalSubjectId:   a?.subjectId   ?? null,
        approvalPriority:    a?.priority    ?? null,
      };
    });

    return { data, total, limit, offset };
  }

  async counts(tenantId: string) {
    const rows = await this.repo
      .createQueryBuilder('a')
      .select('a.status', 'status')
      .addSelect('a.priority', 'priority')
      .addSelect('COUNT(*)::int', 'n')
      .where('a.tenantId = :tenantId', { tenantId })
      .groupBy('a.status')
      .addGroupBy('a.priority')
      .getRawMany<{ status: ApprovalStatus; priority: string; n: number }>();

    const out = {
      total: 0,
      pending: 0,
      pendingCritical: 0,
      modified: 0,
      approved: 0,
      rejected: 0,
      executed: 0,
      expired: 0,
    };
    for (const r of rows) {
      out.total += r.n;
      out[r.status] = (out[r.status] ?? 0) + r.n;
      if (r.status === 'pending' && r.priority === 'critical') {
        out.pendingCritical += r.n;
      }
    }
    return out;
  }

  // ── transitions ──────────────────────────────────────────────────────────

  async modify(
    tenantId: string,
    id: string,
    payload: Record<string, any>,
    actor: ApprovalActor,
    note?: string,
  ): Promise<Approval> {
    const a = await this.getOne(tenantId, id);
    this.assertTransition(a.status, 'modified');

    const diff = this.diff(a.payload, payload);
    if (Object.keys(diff).length === 0) {
      // Nothing actually changed — short-circuit to avoid noise events.
      return a;
    }

    const from = a.status;
    // Preserve original AI proposal only on the FIRST modification.
    if (!a.originalPayload) a.originalPayload = a.payload;
    a.payload = payload;
    a.status  = 'modified';
    const saved = await this.repo.save(a);
    await this.recordEvent(saved, from, 'modified', actor, note, diff);
    return saved;
  }

  async approve(
    tenantId: string,
    id: string,
    actor: ApprovalActor,
    note?: string,
  ): Promise<Approval> {
    if (!actor.userId) throw new ForbiddenException('Approval requires a user identity');
    const a = await this.getOne(tenantId, id);
    this.assertTransition(a.status, 'approved');

    const from = a.status;
    a.status           = 'approved';
    a.reviewedByUserId = actor.userId;
    a.reviewedAt       = new Date();
    a.decisionNote     = note ?? null;
    const saved = await this.repo.save(a);
    await this.recordEvent(saved, from, 'approved', actor, note);
    this.eventEmitter.emit('approval.approved', saved);
    return saved;
  }

  async reject(
    tenantId: string,
    id: string,
    actor: ApprovalActor,
    note?: string,
  ): Promise<Approval> {
    if (!actor.userId) throw new ForbiddenException('Rejection requires a user identity');
    const a = await this.getOne(tenantId, id);
    this.assertTransition(a.status, 'rejected');

    const from = a.status;
    a.status           = 'rejected';
    a.reviewedByUserId = actor.userId;
    a.reviewedAt       = new Date();
    a.decisionNote     = note ?? null;
    const saved = await this.repo.save(a);
    await this.recordEvent(saved, from, 'rejected', actor, note);
    this.eventEmitter.emit('approval.rejected', saved);
    return saved;
  }

  async markExecuted(
    tenantId: string,
    id: string,
    result: Record<string, any>,
    actor: ApprovalActor = { type: 'system' },
  ): Promise<Approval> {
    const a = await this.getOne(tenantId, id);
    this.assertTransition(a.status, 'executed');

    a.status          = 'executed';
    a.executedAt      = new Date();
    a.executionResult = result;
    const saved = await this.repo.save(a);
    await this.recordEvent(saved, 'approved', 'executed', actor);
    return saved;
  }

  async bulkApprove(
    tenantId: string,
    ids: string[],
    actor: ApprovalActor,
    note?: string,
  ): Promise<{ approved: number; skipped: number }> {
    const rows = await this.repo.find({ where: { id: In(ids), tenantId } });
    let approved = 0;
    let skipped = 0;
    for (const r of rows) {
      if (!ALLOWED_TRANSITIONS[r.status].includes('approved')) {
        skipped++;
        continue;
      }
      await this.approve(tenantId, r.id, actor, note);
      approved++;
    }
    return { approved, skipped };
  }

  async bulkReject(
    tenantId: string,
    ids: string[],
    actor: ApprovalActor,
    note?: string,
  ): Promise<{ rejected: number; skipped: number }> {
    const rows = await this.repo.find({ where: { id: In(ids), tenantId } });
    let rejected = 0;
    let skipped = 0;
    for (const r of rows) {
      if (!ALLOWED_TRANSITIONS[r.status].includes('rejected')) {
        skipped++;
        continue;
      }
      await this.reject(tenantId, r.id, actor, note);
      rejected++;
    }
    return { rejected, skipped };
  }

  /**
   * Sweep — flip `pending|modified` rows past their `expiresAt` to `expired`.
   * Called by a scheduled job (see ai-governance scheduler).
   */
  async expireDue(tenantId?: string): Promise<number> {
    const qb = this.repo
      .createQueryBuilder()
      .update(Approval)
      .set({ status: 'expired' })
      .where('"status" IN (:...active)', { active: ['pending', 'modified'] })
      .andWhere('"expiresAt" IS NOT NULL')
      .andWhere('"expiresAt" < now()');
    if (tenantId) qb.andWhere('"tenantId" = :tenantId', { tenantId });
    // Capture pre-update statuses BEFORE the bulk UPDATE so fromStatus is accurate
    // (RETURNING gives the post-update value, which is always 'expired').
    const preQuery = this.repo
      .createQueryBuilder('a')
      .select(['a.id', 'a.tenantId', 'a.agentCode', 'a.status'])
      .where('a.status IN (:...active)', { active: ['pending', 'modified'] })
      .andWhere('a.expiresAt IS NOT NULL')
      .andWhere('a.expiresAt < now()');
    if (tenantId) preQuery.andWhere('a.tenantId = :tenantId', { tenantId });
    const toExpire = await preQuery.getMany();

    if (toExpire.length === 0) return 0;

    await qb.execute();

    for (const r of toExpire) {
      await this.events.save(
        this.events.create({
          approvalId: r.id,
          tenantId:   r.tenantId,
          agentCode:  r.agentCode,
          fromStatus: r.status,
          toStatus:   'expired',
          actorType:  'scheduler',
          actorUserId: null,
          note:        'Auto-expired by sweeper',
        }),
      );
    }
    return toExpire.length;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private assertTransition(from: ApprovalStatus, to: ApprovalStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `Illegal approval transition: ${from} → ${to}`,
      );
    }
  }

  private async recordEvent(
    a: Approval,
    from: ApprovalStatus | null,
    to: ApprovalStatus,
    actor: ApprovalActor,
    note?: string,
    diff?: Record<string, { from: any; to: any }>,
  ): Promise<void> {
    await this.events.save(
      this.events.create({
        approvalId:  a.id,
        tenantId:    a.tenantId,
        agentCode:   a.agentCode,
        fromStatus:  from,
        toStatus:    to,
        actorUserId: actor.userId ?? null,
        actorType:   actor.type,
        note:        note ?? null,
        payloadDiff: diff ?? null,
      }),
    );
  }

  /**
   * Shallow JSON diff: returns `{ key: { from, to } }` for every key that
   * differs at the top level. Deep diff would over-report on nested objects
   * — for governance evidence a shallow record is the right granularity.
   */
  private diff(
    a: Record<string, any>,
    b: Record<string, any>,
  ): Record<string, { from: any; to: any }> {
    const out: Record<string, { from: any; to: any }> = {};
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const k of keys) {
      const av = a?.[k];
      const bv = b?.[k];
      if (JSON.stringify(av) !== JSON.stringify(bv)) {
        out[k] = { from: av, to: bv };
      }
    }
    return out;
  }
}

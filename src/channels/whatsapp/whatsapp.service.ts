import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';

import { WhatsappMessage } from './entities/whatsapp-message.entity';
import {
  Approval,
  ApprovalStatus,
} from '../../ai-governance/entities/approval.entity';
import { OrchestratorResult } from '../../procurement/procurement-orchestrator.types';

/**
 * WhatsApp channel — DISABLED BY DEFAULT.
 *
 * Enabling requires:
 *   WHATSAPP_ENABLED=true
 *   WHATSAPP_BSP=meta|360dialog
 *   WHATSAPP_APP_SECRET=<bsp app secret used to sign webhooks>
 *   (BSP-specific outbound credentials wired in `sendApprovalCard`)
 *
 * What this scaffold does today:
 *   - Persists every inbound/outbound message with an idempotent unique
 *     index on providerMessageId (`uq_whatsapp_provider_message_id`).
 *   - Verifies inbound webhook signatures using HMAC-SHA256 + constant-time
 *     compare. Returns false on missing config or signature mismatch.
 *   - Renders a unified procurement-plan card from an OrchestratorResult
 *     into a structured payload that any BSP template can consume. This is
 *     the same payload shape that the UI uses — one builder, three
 *     renderers (UI / WhatsApp / email).
 *   - Translates inbound "1" / "approve" / "موافق" replies into a SINGLE
 *     status transition on an existing Approval row. It NEVER mutates qty,
 *     price, or supplier — WhatsApp is a renderer, never a source of truth.
 *
 * What this scaffold does NOT do yet (deferred to vendor selection):
 *   - Actual HTTP call to Meta Cloud API / 360dialog. `sendOutbound`
 *     persists `queued` and logs the payload; a follow-up adapter
 *     implements the network call.
 *
 * Performance: every entry point starts with an `enabled` short-circuit so
 * the disabled path costs one config read. Safe to mount in production.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly enabled: boolean;
  private readonly appSecret: string | null;

  constructor(
    cfg: ConfigService,
    @InjectRepository(WhatsappMessage)
    private readonly messageRepo: Repository<WhatsappMessage>,
    @InjectRepository(Approval)
    private readonly approvalRepo: Repository<Approval>,
    @InjectDataSource() private readonly ds: DataSource,
  ) {
    this.enabled = (cfg.get<string>('WHATSAPP_ENABLED') ?? 'false').toLowerCase() === 'true';
    this.appSecret = cfg.get<string>('WHATSAPP_APP_SECRET') ?? null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ─── INBOUND ──────────────────────────────────────────────────────────────

  /**
   * Verify the BSP webhook signature header.
   * Returns true on match, false on any failure (missing secret, missing
   * header, length mismatch, hash mismatch). Never throws.
   */
  verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!this.appSecret) {
      this.logger.warn('WHATSAPP_APP_SECRET not set — refusing all webhook signatures');
      return false;
    }
    if (!signatureHeader) return false;

    // Meta sends "sha256=<hex>". Strip the prefix if present.
    const provided = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice(7)
      : signatureHeader;

    const expected = createHmac('sha256', this.appSecret).update(rawBody).digest('hex');

    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Process a single inbound message.
   *
   * Idempotent: re-deliveries with the same providerMessageId resolve to
   * the previously stored row without side effects.
   *
   * Returns the persisted message row, or null when the channel is
   * disabled and the call should be ignored upstream.
   */
  async handleInbound(input: {
    tenantId: string;
    providerMessageId: string;
    phone: string;
    bodyText: string;
    approvalId?: string | null;
  }): Promise<WhatsappMessage | null> {
    if (!this.enabled) return null;

    // ON CONFLICT DO NOTHING — the unique index on providerMessageId
    // guarantees a single canonical row even under webhook retries.
    const rows = await this.ds.query(
      `INSERT INTO "whatsapp_messages"
        ("tenantId","direction","providerMessageId","phone","templateOrPreview","approvalId","status","payload")
       VALUES ($1, 'inbound', $2, $3, $4, $5, 'received', $6::jsonb)
       ON CONFLICT ("providerMessageId") DO NOTHING
       RETURNING id, status`,
      [
        input.tenantId,
        input.providerMessageId,
        input.phone,
        input.bodyText.slice(0, 200),
        input.approvalId ?? null,
        JSON.stringify({ body: input.bodyText.slice(0, 1000) }),
      ],
    );

    if (!rows?.length) {
      // Retry of a previously-handled webhook — return the stored row.
      const existing = await this.messageRepo.findOne({
        where: { providerMessageId: input.providerMessageId },
      });
      return existing;
    }

    const messageId = rows[0].id as string;

    // Only attempt approval transition when explicitly linked and the
    // reply is a recognised intent. Unrecognised messages are logged as
    // 'ignored' so the BSP doesn't keep retrying.
    const intent = this.classifyReply(input.bodyText);
    let nextApprovalStatus: ApprovalStatus | null = null;
    if (intent === 'approve') nextApprovalStatus = 'approved';
    if (intent === 'reject')  nextApprovalStatus = 'rejected';

    if (input.approvalId && nextApprovalStatus) {
      try {
        // Conditional update: only transition if still pending. This is
        // the immutability boundary — we never overwrite a terminal state.
        const upd = await this.approvalRepo
          .createQueryBuilder()
          .update(Approval)
          .set({ status: nextApprovalStatus, decisionNote: 'whatsapp_reply', reviewedAt: new Date() })
          .where('id = :id AND status = :pending', {
            id: input.approvalId,
            pending: 'pending',
          })
          .execute();

        await this.messageRepo.update(messageId, {
          status: upd.affected ? 'processed' : 'ignored',
        });
      } catch (err) {
        await this.messageRepo.update(messageId, {
          status: 'failed',
          errorReason: `approval transition failed: ${(err as Error).message.slice(0, 400)}`,
        });
      }
    } else {
      await this.messageRepo.update(messageId, { status: 'ignored' });
    }

    return this.messageRepo.findOne({ where: { id: messageId } });
  }

  // ─── OUTBOUND ─────────────────────────────────────────────────────────────

  /**
   * Render a procurement plan card to a structured WhatsApp payload and
   * persist it as `queued`. The actual HTTP send is handled by a
   * BSP-specific adapter (not in this scaffold) which flips `queued` →
   * `sent`/`failed`.
   */
  async sendApprovalCard(input: {
    tenantId: string;
    phone: string;
    approvalId: string;
    plan: OrchestratorResult;
  }): Promise<{ persisted: boolean; reason?: string }> {
    if (!this.enabled) return { persisted: false, reason: 'channel_disabled' };

    const card = buildApprovalCardPayload(input.plan);

    // Use the approvalId as the provider id placeholder until the BSP
    // returns the real one — then the adapter updates this row by id.
    const placeholderProviderId = `local:${input.approvalId}`;

    await this.ds.query(
      `INSERT INTO "whatsapp_messages"
        ("tenantId","direction","providerMessageId","phone","templateOrPreview","approvalId","status","payload")
       VALUES ($1, 'outbound', $2, $3, $4, $5, 'queued', $6::jsonb)
       ON CONFLICT ("providerMessageId") DO NOTHING`,
      [
        input.tenantId,
        placeholderProviderId,
        input.phone,
        'procurement_plan',
        input.approvalId,
        JSON.stringify(card),
      ],
    );

    this.logger.log(
      `WhatsApp queued: tenant=${input.tenantId} approval=${input.approvalId} cost=${input.plan.totalCost}`,
    );
    return { persisted: true };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private classifyReply(body: string): 'approve' | 'reject' | 'unknown' {
    const t = body.trim().toLowerCase();
    if (!t) return 'unknown';
    if (['1', 'approve', 'yes', 'ok', 'موافق', 'نعم', 'موافقة'].includes(t)) return 'approve';
    if (['2', 'reject', 'no', 'cancel', 'رفض', 'لا', 'إلغاء', 'الغاء'].includes(t)) return 'reject';
    return 'unknown';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ONE renderer to rule them all: UI / WhatsApp / email all serialise the
//  same OrchestratorResult through this single function. Keeping it here
//  (vs ai-governance) avoids a cycle; promote later if it grows.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovalCardPayload {
  headline: string;
  product:  string;
  qty:      number;
  splits: Array<{ source: 'p2p' | 'supplier'; name: string; qty: number; unitPrice: number }>;
  totalCost: number;
  finance: {
    creditAvailable: number;
    afterPurchaseRemaining: number;
    cashRisk: 'low' | 'medium' | 'high';
    recommendation: 'approve_now' | 'approve_with_caution' | 'delay_recommended';
  };
  delay: {
    days: number;
    reasonCode: string;
    humanReason: string;
    confidence: 'low' | 'medium' | 'high';
  } | null;
  confidence: number;
  cta: Array<{ key: string; label: string }>;
}

export function buildApprovalCardPayload(plan: OrchestratorResult): ApprovalCardPayload {
  const afterPurchaseRemaining = Math.max(
    0,
    plan.financialStatus.creditAvailable - plan.totalCost,
  );

  const cta: ApprovalCardPayload['cta'] = [
    { key: 'approve', label: 'موافقة' },
    { key: 'modify',  label: 'تعديل' },
    { key: 'why',     label: 'لماذا؟' },
  ];
  if (plan.delayRecommendation) {
    cta.push({ key: 'delay', label: `تأجيل ${plan.delayRecommendation.recommendedDelayDays} أيام` });
  }

  return {
    headline: `طلب شراء ذكي — ${plan.productName}`,
    product:  plan.productName,
    qty:      plan.qtyRequired,
    splits:   plan.splits.map((s) => ({
      source:    s.source,
      name:      s.sourceName,
      qty:       s.qty,
      unitPrice: s.unitPrice,
    })),
    totalCost: plan.totalCost,
    finance: {
      creditAvailable: plan.financialStatus.creditAvailable,
      afterPurchaseRemaining,
      cashRisk:        plan.financialStatus.cashRisk,
      recommendation:  plan.financialStatus.recommendation,
    },
    delay: plan.delayRecommendation
      ? {
          days:        plan.delayRecommendation.recommendedDelayDays,
          reasonCode:  plan.delayRecommendation.reasonCode,
          humanReason: plan.delayRecommendation.humanReason,
          confidence:  plan.delayRecommendation.confidence,
        }
      : null,
    confidence: plan.confidence,
    cta,
  };
}

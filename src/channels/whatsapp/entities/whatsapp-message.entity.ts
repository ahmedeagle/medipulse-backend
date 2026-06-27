import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type WaDirection = 'inbound' | 'outbound';

export type WaStatus =
  | 'received'      // inbound: just landed via webhook
  | 'processed'     // inbound: handled (approval transition, ack, etc.)
  | 'ignored'       // inbound: not actionable (no matching approval, opt-out, etc.)
  | 'queued'        // outbound: waiting to send
  | 'sent'          // outbound: BSP accepted
  | 'delivered'     // outbound: delivered to handset
  | 'read'          // outbound: read receipt
  | 'failed';       // outbound: BSP rejected or undeliverable

/**
 * Idempotent persistent log of every WhatsApp message we touch.
 *
 * Two critical invariants:
 *
 *   1. `providerMessageId` is UNIQUE — the webhook handler can be retried
 *      by Meta/360dialog without producing duplicate state changes.
 *
 *   2. WhatsApp is an interface, never a source of truth. The only
 *      mutation an inbound message can cause is a status transition on an
 *      existing `Approval` row, recorded via `approvalId`. Qty, price,
 *      and supplier on the underlying plan are immutable post-creation.
 */
@Entity('whatsapp_messages')
@Index('uq_whatsapp_provider_message_id', ['providerMessageId'], { unique: true })
@Index(['tenantId', 'createdAt'])
@Index(['approvalId'])
export class WhatsappMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 10 })
  direction: WaDirection;

  /** Provider-assigned id from the BSP (Meta / 360dialog). Required. */
  @Column({ type: 'varchar', length: 128 })
  providerMessageId: string;

  /** E.164 phone number — outbound: recipient, inbound: sender. */
  @Column({ type: 'varchar', length: 32 })
  phone: string;

  /** Template name (outbound) or message text excerpt (inbound, redacted). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  templateOrPreview: string | null;

  /** Linked approval — present whenever the message is tied to a decision. */
  @Column({ type: 'uuid', nullable: true })
  approvalId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: WaStatus;

  /** Last error from the BSP (truncated). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  errorReason: string | null;

  /** Free-form payload snapshot for audit (template variables / inbound body). */
  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

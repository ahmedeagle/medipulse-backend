import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/**
 * notification_preferences — per-pharmacy (and optionally per-user) delivery control.
 *
 * This is the "Preference Filter" in the delivery pipeline:
 *   Event → Decision (severity/channels) → **Preference Filter** → Dispatcher → Channel
 *
 * Resolution order when delivering: a row scoped to the specific userId wins;
 * otherwise the tenant-wide default row (userId IS NULL) applies; otherwise the
 * hard-coded safe defaults (WhatsApp + push OFF) apply. Risky channels are opt-in
 * by design — nothing is ever blasted without the pharmacy explicitly enabling it.
 */
@Entity('notification_preferences')
@Index('idx_notif_pref_tenant', ['pharmacyTenantId'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  /** NULL = tenant-wide default applied to every user without their own row. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  // ── Channels ──────────────────────────────────────────────────────────────
  /** In-app is always on in practice; stored for completeness/UI. */
  @Column({ type: 'boolean', default: true })
  inApp: boolean;

  @Column({ type: 'boolean', default: true })
  email: boolean;

  /** Opt-in only. Default OFF — never send WhatsApp unless the pharmacy enables it. */
  @Column({ type: 'boolean', default: false })
  whatsapp: boolean;

  /** Opt-in only. Default OFF. */
  @Column({ type: 'boolean', default: false })
  push: boolean;

  // ── Severity rules ────────────────────────────────────────────────────────
  @Column({ type: 'boolean', default: true })
  allowLow: boolean;

  @Column({ type: 'boolean', default: true })
  allowMedium: boolean;

  @Column({ type: 'boolean', default: true })
  allowHigh: boolean;

  @Column({ type: 'boolean', default: true })
  allowCritical: boolean;

  // ── Quiet hours (suppress non-critical push/WhatsApp) ─────────────────────
  /** Minutes from local midnight [0..1439]. NULL = no quiet hours. */
  @Column({ type: 'smallint', nullable: true })
  quietHoursStart: number | null;

  @Column({ type: 'smallint', nullable: true })
  quietHoursEnd: number | null;

  /** IANA timezone used to evaluate quiet hours. */
  @Column({ type: 'varchar', length: 40, default: 'Africa/Cairo' })
  quietHoursTimezone: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

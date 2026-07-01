import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { Notification } from './entities/notification.entity';
import { NotificationSeverity, NotificationChannel } from './notification-policy';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * The Delivery Dispatcher — the final stage of:
 *   Event → Decision → Preference Filter → **Dispatcher** → Channel
 *
 * It decides the effective channels (via the Preference Filter) and performs the
 * side-effecting external delivery. Only WhatsApp is dispatched here today, and
 * only when EVERY guard passes:
 *   • global kill-switch WHATSAPP_ENABLED=true (env)
 *   • the tenant opted in (pref.whatsapp) and severity allows it (→ 'whatsapp' in channels)
 *   • a WhatsApp number exists for the tenant
 * Push has no provider yet, so it is recorded as intent but not sent (honest).
 * Everything is idempotent and non-fatal — delivery never breaks the caller.
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly preferences: NotificationPreferencesService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** Resolve the effective channels for a delivery (Preference Filter). */
  async route(
    tenantId: string,
    userId: string | null,
    severity: NotificationSeverity,
    intended: NotificationChannel[],
  ): Promise<NotificationChannel[]> {
    const pref = await this.preferences.resolve(tenantId, userId);
    return this.preferences.applyFilter(severity, intended, pref);
  }

  /**
   * Perform external delivery for a persisted notification based on its stored
   * effective channels. In-app is already delivered (the row itself). Non-fatal.
   */
  async dispatchExternal(notification: Notification): Promise<void> {
    const channels = (notification.channels ?? []) as NotificationChannel[];
    if (!channels.includes('whatsapp')) return;
    if (!this.whatsappEnabled()) return;
    try {
      await this.enqueueWhatsapp(notification);
    } catch (err) {
      this.logger.warn(
        `whatsapp dispatch skipped for notification ${notification.id}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  private whatsappEnabled(): boolean {
    return (this.config.get<string>('WHATSAPP_ENABLED') ?? 'false').toLowerCase() === 'true';
  }

  /** Idempotent enqueue into the shared whatsapp_messages outbound queue. */
  private async enqueueWhatsapp(n: Notification): Promise<void> {
    const [profile] = await this.dataSource.query<Array<{ whatsapp: string | null }>>(
      `SELECT "whatsapp" FROM seller_profiles WHERE "pharmacyTenantId" = $1 LIMIT 1`,
      [n.tenantId],
    );
    const phone = profile?.whatsapp?.trim();
    if (!phone) return; // no number on file — cannot deliver, stay silent

    const text = `${n.title}\n\n${n.body}`;
    await this.dataSource.query(
      `INSERT INTO "whatsapp_messages"
         ("tenantId","direction","providerMessageId","phone","templateOrPreview","status","payload")
       VALUES ($1, 'outbound', $2, $3, $4, 'queued', $5::jsonb)
       ON CONFLICT ("providerMessageId") DO NOTHING`,
      [
        n.tenantId,
        `notif:${n.id}`, // idempotency key — one WhatsApp per notification
        phone,
        n.type,
        JSON.stringify({ notificationId: n.id, type: n.type, severity: n.severity, title: n.title, text }),
      ],
    );
  }
}

import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Redis from 'ioredis';
import { KeycloakAuthEvent } from '../audit/entities/keycloak-auth-event.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';

const LAST_POLL_KEY = 'medipulse:kc:events:lastpoll';
const POLL_WINDOW_MS = 6 * 60 * 1_000; // 6 minutes — slightly more than cron interval

const CAPTURED_EVENT_TYPES = [
  'LOGIN',
  'LOGOUT',
  'LOGIN_ERROR',
  'REGISTER',
  'UPDATE_PASSWORD',
  'RESET_PASSWORD',
  'SEND_VERIFY_EMAIL',
  'UPDATE_EMAIL',
  'REVOKE_GRANT',
  'TOKEN_EXCHANGE',
  'CLIENT_LOGIN',
  'LOGOUT_ERROR',
];

interface KcEvent {
  id?:          string;
  type:         string;
  userId?:      string;
  sessionId?:   string;
  ipAddress?:   string;
  clientId?:    string;
  details?:     Record<string, any>;
  time:         number; // ms epoch
}

/**
 * Polls Keycloak's Admin API for authentication events and stores them
 * in the dedicated audit DB.
 *
 * Pre-requisite (one-time KC setup):
 *   Add 'view-events' role to the medipulse-api service account:
 *   KC Admin → Clients → medipulse-api → Service Account Roles
 *   → realm-management → view-events
 *
 * Also enable event logging in KC:
 *   KC Admin → realm medipulse → Realm Settings → Events
 *   → Save Events: ON
 *   → Expiration: 30 days
 */
@Injectable()
export class KeycloakEventsService {
  private readonly logger = new Logger(KeycloakEventsService.name);
  private readonly kcUrl:    string;
  private readonly realm:    string;
  private readonly clientId: string;
  private readonly secret:   string;

  private adminToken: string | null = null;
  private tokenExpiry = 0;

  constructor(
    @InjectRepository(KeycloakAuthEvent, 'audit')
    private readonly repo: Repository<KeycloakAuthEvent>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.kcUrl    = config.get<string>('KC_URL');
    this.realm    = config.get<string>('KC_REALM');
    this.clientId = config.get<string>('KC_CLIENT_ID');
    this.secret   = config.get<string>('KC_CLIENT_SECRET');
  }

  /** Poll KC auth events every 5 minutes */
  @Cron('0 */5 * * * *')
  async poll(): Promise<void> {
    try {
      await this.pollEvents();
    } catch (err: any) {
      this.logger.error(`KC event poll failed: ${err.message}`);
    }
  }

  /** Manual trigger — callable from admin controller for testing */
  async pollEvents(): Promise<{ imported: number }> {
    const token = await this.getAdminToken();
    const lastPollMs = await this.getLastPollTime();
    const dateFrom   = new Date(lastPollMs).toISOString().replace('Z', '+00:00');

    const params = new URLSearchParams({
      dateFrom,
      max: '500',
    });
    CAPTURED_EVENT_TYPES.forEach((t) => params.append('type', t));

    const { data: events } = await axios.get<KcEvent[]>(
      `${this.kcUrl}/admin/realms/${this.realm}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!events.length) {
      await this.setLastPollTime(Date.now());
      return { imported: 0 };
    }

    let imported = 0;
    for (const ev of events) {
      const kcEventId = ev.id ?? `${ev.type}-${ev.userId ?? 'anon'}-${ev.time}`;

      const exists = await this.repo.findOne({ where: { kcEventId } });
      if (exists) continue;

      try {
        await this.repo.save(
          this.repo.create({
            kcEventId,
            eventType:  ev.type,
            kcUserId:   ev.userId   ?? null,
            sessionId:  ev.sessionId ?? null,
            ipAddress:  ev.ipAddress ?? null,
            clientId:   ev.clientId  ?? null,
            details:    ev.details   ?? null,
            time:       ev.time,
            tenantId:   ev.details?.['tenantId'] ?? null,
          }),
        );
        imported++;
      } catch {
        // Duplicate race condition — safe to skip
      }
    }

    await this.setLastPollTime(Date.now());
    if (imported) this.logger.log(`KC events imported: ${imported}`);
    return { imported };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async getAdminToken(): Promise<string> {
    if (this.adminToken && Date.now() < this.tokenExpiry) return this.adminToken;

    const params = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     this.clientId,
      client_secret: this.secret,
    });

    const { data } = await axios.post(
      `${this.kcUrl}/realms/${this.realm}/protocol/openid-connect/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    this.adminToken = data.access_token;
    this.tokenExpiry = Date.now() + 55_000;
    return this.adminToken;
  }

  private async getLastPollTime(): Promise<number> {
    const val = await this.redis.get(LAST_POLL_KEY);
    return val ? parseInt(val, 10) : Date.now() - POLL_WINDOW_MS;
  }

  private async setLastPollTime(ts: number): Promise<void> {
    await this.redis.set(LAST_POLL_KEY, ts.toString());
  }
}

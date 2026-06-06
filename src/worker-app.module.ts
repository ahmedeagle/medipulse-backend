import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AiWorkerModule } from './ai/ai-worker.module';
import { AuditWorkerModule } from './audit/audit-worker.module';
import { WebhooksWorkerModule } from './webhooks/webhooks-worker.module';
import { AnalyticsWorkerModule } from './analytics/analytics-worker.module';
import { AuthEventsModule } from './auth/auth-events.module';
import { ForecastingWorkerModule } from './forecasting/forecasting-worker.module';
import { ProcurementWorkerModule } from './procurement/procurement-worker.module';
import { MatchWorkerModule } from './inventory/match-worker.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';

/**
 * Root module for the worker process (src/worker.ts).
 *
 * Differences from AppModule:
 *   - No HTTP middleware (Helmet, CORS, throttle, Swagger)
 *   - No controllers except /health
 *   - Includes ALL processor modules (AI + Audit + Webhook)
 *   - Connects to both main DB and audit DB
 *   - EventEmitter for in-process events (webhook dispatch listener lives in HTTP app,
 *     but worker processors may emit their own internal events in future)
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
    ScheduleModule.forRoot(),

    // ── Main application DB ───────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        extra: { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 2_000 },
      }),
    }),

    // ── Dedicated audit DB ────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      name: 'audit',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('AUDIT_DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        extra: { max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 2_000 },
      }),
    }),

    // ── Redis / BullMQ ────────────────────────────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        connection: {
          host:     cfg.get<string>('REDIS_HOST', 'localhost'),
          port:     cfg.get<number>('REDIS_PORT', 6379),
          password: cfg.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),

    // ── Worker modules — processors run HERE, never in the HTTP app ──────────
    AiWorkerModule,
    AuditWorkerModule,
    WebhooksWorkerModule,
    AnalyticsWorkerModule,
    AuthEventsModule,
    ForecastingWorkerModule,
    ProcurementWorkerModule,
    MatchWorkerModule,
    NotificationsModule,

    // ── Minimal health endpoint for container probes ──────────────────────────
    HealthModule,
  ],
})
export class WorkerAppModule {}

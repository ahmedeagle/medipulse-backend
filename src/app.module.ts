import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { InventoryModule } from './inventory/inventory.module';
import { SupplierModule } from './supplier/supplier.module';
import { OrdersModule } from './orders/orders.module';
import { AiModule } from './ai/ai.module';
import { AiGovernanceModule } from './ai-governance/ai-governance.module';
import { AuditModule } from './audit/audit.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { NormalizationModule } from './normalization/normalization.module';
import { ProcurementModule } from './procurement/procurement.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthEventsModule } from './auth/auth-events.module';
import { ForecastingModule } from './forecasting/forecasting.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WorkflowModule } from './workflow/workflow.module';
import { FinancialModule } from './financial/financial.module';
import { SecurityModule } from './security/security.module';
import { CatalogRequestsModule } from './catalog-requests/catalog-requests.module';
import { P2pSellerModule } from './p2p-seller/p2p-seller.module';
import { P2pListingModule } from './p2p-listing/p2p-listing.module';
import { P2pOrdersModule } from './p2p-orders/p2p-orders.module';
import { P2pMarketplaceModule } from './p2p-marketplace/p2p-marketplace.module';
import { PharmacySettingsModule } from './pharmacy-settings/pharmacy-settings.module';
import { ChatModule }             from './chat/chat.module';
import { PosModule }              from './pos/pos.module';
import { FraudModule }            from './fraud/fraud.module';
import { FeatureRequestsModule }  from './feature-requests/feature-requests.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // ── In-process domain event bus ───────────────────────────────────────────
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),

    // ── Cron / scheduled jobs ─────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Main application DB ───────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // synchronize: NEVER true in any environment.
        // Use `npm run migration:run` to apply schema changes safely.
        // synchronize:true silently drops columns and has no rollback —
        // unacceptable for a healthcare system handling pharmacy inventory data.
        synchronize: false,
        migrationsRun: false,  // run manually via npm run migration:run
        logging: cfg.get<string>('NODE_ENV') === 'development',
        extra: {
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 2_000,
        },
        subscribers: ['dist/security/tenant-isolation.subscriber.js'],
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

    // ── BullMQ — async job queues (backed by Redis) ───────────────────────────
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

    // ── Global rate limiting ──────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),

    AuthModule,
    InventoryModule,
    SupplierModule,
    OrdersModule,
    AiModule,
    AiGovernanceModule,
    AuditModule,
    AdminModule,
    HealthModule,
    EventsModule,
    WebhooksModule,
    NormalizationModule,
    ProcurementModule,
    OrganizationsModule,
    IntegrationsModule,
    AnalyticsModule,
    AuthEventsModule,
    ForecastingModule,
    NotificationsModule,
    WorkflowModule,
    FinancialModule,
    SecurityModule,
    CatalogRequestsModule,
    // ── Pharmacy Exchange Network (PEN) ───────────────────────────────────────
    P2pSellerModule,
    P2pListingModule,
    P2pOrdersModule,
    P2pMarketplaceModule,
    // ── Pharmacy Settings ─────────────────────────────────────────────────────
    PharmacySettingsModule,
    // ── AI Chat & Fraud Detection ─────────────────────────────────────────────
    ChatModule,
    FraudModule,
    FeatureRequestsModule,
    // ── Point of Sale ─────────────────────────────────────────────────────────
    PosModule,
  ],

  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}

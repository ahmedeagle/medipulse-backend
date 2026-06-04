"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const throttler_1 = require("@nestjs/throttler");
const bullmq_1 = require("@nestjs/bullmq");
const event_emitter_1 = require("@nestjs/event-emitter");
const schedule_1 = require("@nestjs/schedule");
const core_1 = require("@nestjs/core");
const auth_module_1 = require("./auth/auth.module");
const inventory_module_1 = require("./inventory/inventory.module");
const supplier_module_1 = require("./supplier/supplier.module");
const orders_module_1 = require("./orders/orders.module");
const ai_module_1 = require("./ai/ai.module");
const audit_module_1 = require("./audit/audit.module");
const admin_module_1 = require("./admin/admin.module");
const health_module_1 = require("./health/health.module");
const events_module_1 = require("./events/events.module");
const webhooks_module_1 = require("./webhooks/webhooks.module");
const normalization_module_1 = require("./normalization/normalization.module");
const procurement_module_1 = require("./procurement/procurement.module");
const organizations_module_1 = require("./organizations/organizations.module");
const integrations_module_1 = require("./integrations/integrations.module");
const analytics_module_1 = require("./analytics/analytics.module");
const auth_events_module_1 = require("./auth/auth-events.module");
const forecasting_module_1 = require("./forecasting/forecasting.module");
const notifications_module_1 = require("./notifications/notifications.module");
const workflow_module_1 = require("./workflow/workflow.module");
const financial_module_1 = require("./financial/financial.module");
const security_module_1 = require("./security/security.module");
const correlation_id_middleware_1 = require("./common/middleware/correlation-id.middleware");
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(correlation_id_middleware_1.CorrelationIdMiddleware).forRoutes('*');
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
            event_emitter_1.EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
            schedule_1.ScheduleModule.forRoot(),
            typeorm_1.TypeOrmModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (cfg) => ({
                    type: 'postgres',
                    url: cfg.get('DATABASE_URL'),
                    autoLoadEntities: true,
                    synchronize: false,
                    migrationsRun: false,
                    logging: cfg.get('NODE_ENV') === 'development',
                    extra: {
                        max: 20,
                        idleTimeoutMillis: 30_000,
                        connectionTimeoutMillis: 2_000,
                    },
                    subscribers: ['dist/security/tenant-isolation.subscriber.js'],
                }),
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                name: 'audit',
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (cfg) => ({
                    type: 'postgres',
                    url: cfg.get('AUDIT_DATABASE_URL'),
                    autoLoadEntities: true,
                    synchronize: false,
                    migrationsRun: false,
                    extra: { max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 2_000 },
                }),
            }),
            bullmq_1.BullModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (cfg) => ({
                    connection: {
                        host: cfg.get('REDIS_HOST', 'localhost'),
                        port: cfg.get('REDIS_PORT', 6379),
                        password: cfg.get('REDIS_PASSWORD') || undefined,
                    },
                }),
            }),
            throttler_1.ThrottlerModule.forRoot([
                { name: 'default', ttl: 60_000, limit: 100 },
            ]),
            auth_module_1.AuthModule,
            inventory_module_1.InventoryModule,
            supplier_module_1.SupplierModule,
            orders_module_1.OrdersModule,
            ai_module_1.AiModule,
            audit_module_1.AuditModule,
            admin_module_1.AdminModule,
            health_module_1.HealthModule,
            events_module_1.EventsModule,
            webhooks_module_1.WebhooksModule,
            normalization_module_1.NormalizationModule,
            procurement_module_1.ProcurementModule,
            organizations_module_1.OrganizationsModule,
            integrations_module_1.IntegrationsModule,
            analytics_module_1.AnalyticsModule,
            auth_events_module_1.AuthEventsModule,
            forecasting_module_1.ForecastingModule,
            notifications_module_1.NotificationsModule,
            workflow_module_1.WorkflowModule,
            financial_module_1.FinancialModule,
            security_module_1.SecurityModule,
        ],
        providers: [
            { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map
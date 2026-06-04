"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerAppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const bullmq_1 = require("@nestjs/bullmq");
const event_emitter_1 = require("@nestjs/event-emitter");
const schedule_1 = require("@nestjs/schedule");
const ai_worker_module_1 = require("./ai/ai-worker.module");
const audit_worker_module_1 = require("./audit/audit-worker.module");
const webhooks_worker_module_1 = require("./webhooks/webhooks-worker.module");
const analytics_worker_module_1 = require("./analytics/analytics-worker.module");
const auth_events_module_1 = require("./auth/auth-events.module");
const forecasting_worker_module_1 = require("./forecasting/forecasting-worker.module");
const procurement_worker_module_1 = require("./procurement/procurement-worker.module");
const notifications_module_1 = require("./notifications/notifications.module");
const health_module_1 = require("./health/health.module");
let WorkerAppModule = class WorkerAppModule {
};
exports.WorkerAppModule = WorkerAppModule;
exports.WorkerAppModule = WorkerAppModule = __decorate([
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
                    extra: { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 2_000 },
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
            ai_worker_module_1.AiWorkerModule,
            audit_worker_module_1.AuditWorkerModule,
            webhooks_worker_module_1.WebhooksWorkerModule,
            analytics_worker_module_1.AnalyticsWorkerModule,
            auth_events_module_1.AuthEventsModule,
            forecasting_worker_module_1.ForecastingWorkerModule,
            procurement_worker_module_1.ProcurementWorkerModule,
            notifications_module_1.NotificationsModule,
            health_module_1.HealthModule,
        ],
    })
], WorkerAppModule);
//# sourceMappingURL=worker-app.module.js.map
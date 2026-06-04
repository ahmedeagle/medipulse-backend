"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var KeycloakEventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeycloakEventsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
const ioredis_1 = require("ioredis");
const keycloak_auth_event_entity_1 = require("../audit/entities/keycloak-auth-event.entity");
const redis_module_1 = require("../common/redis/redis.module");
const LAST_POLL_KEY = 'medipulse:kc:events:lastpoll';
const POLL_WINDOW_MS = 6 * 60 * 1_000;
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
let KeycloakEventsService = KeycloakEventsService_1 = class KeycloakEventsService {
    constructor(repo, redis, config) {
        this.repo = repo;
        this.redis = redis;
        this.config = config;
        this.logger = new common_1.Logger(KeycloakEventsService_1.name);
        this.adminToken = null;
        this.tokenExpiry = 0;
        this.kcUrl = config.get('KC_URL');
        this.realm = config.get('KC_REALM');
        this.clientId = config.get('KC_CLIENT_ID');
        this.secret = config.get('KC_CLIENT_SECRET');
    }
    async poll() {
        try {
            await this.pollEvents();
        }
        catch (err) {
            this.logger.error(`KC event poll failed: ${err.message}`);
        }
    }
    async pollEvents() {
        const token = await this.getAdminToken();
        const lastPollMs = await this.getLastPollTime();
        const dateFrom = new Date(lastPollMs).toISOString().replace('Z', '+00:00');
        const params = new URLSearchParams({
            dateFrom,
            max: '500',
        });
        CAPTURED_EVENT_TYPES.forEach((t) => params.append('type', t));
        const { data: events } = await axios_1.default.get(`${this.kcUrl}/admin/realms/${this.realm}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!events.length) {
            await this.setLastPollTime(Date.now());
            return { imported: 0 };
        }
        let imported = 0;
        for (const ev of events) {
            const kcEventId = ev.id ?? `${ev.type}-${ev.userId ?? 'anon'}-${ev.time}`;
            const exists = await this.repo.findOne({ where: { kcEventId } });
            if (exists)
                continue;
            try {
                await this.repo.save(this.repo.create({
                    kcEventId,
                    eventType: ev.type,
                    kcUserId: ev.userId ?? null,
                    sessionId: ev.sessionId ?? null,
                    ipAddress: ev.ipAddress ?? null,
                    clientId: ev.clientId ?? null,
                    details: ev.details ?? null,
                    time: ev.time,
                    tenantId: ev.details?.['tenantId'] ?? null,
                }));
                imported++;
            }
            catch {
            }
        }
        await this.setLastPollTime(Date.now());
        if (imported)
            this.logger.log(`KC events imported: ${imported}`);
        return { imported };
    }
    async getAdminToken() {
        if (this.adminToken && Date.now() < this.tokenExpiry)
            return this.adminToken;
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.secret,
        });
        const { data } = await axios_1.default.post(`${this.kcUrl}/realms/${this.realm}/protocol/openid-connect/token`, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        this.adminToken = data.access_token;
        this.tokenExpiry = Date.now() + 55_000;
        return this.adminToken;
    }
    async getLastPollTime() {
        const val = await this.redis.get(LAST_POLL_KEY);
        return val ? parseInt(val, 10) : Date.now() - POLL_WINDOW_MS;
    }
    async setLastPollTime(ts) {
        await this.redis.set(LAST_POLL_KEY, ts.toString());
    }
};
exports.KeycloakEventsService = KeycloakEventsService;
__decorate([
    (0, schedule_1.Cron)('0 */5 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], KeycloakEventsService.prototype, "poll", null);
exports.KeycloakEventsService = KeycloakEventsService = KeycloakEventsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(keycloak_auth_event_entity_1.KeycloakAuthEvent, 'audit')),
    __param(1, (0, common_1.Inject)(redis_module_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        ioredis_1.default,
        config_1.ConfigService])
], KeycloakEventsService);
//# sourceMappingURL=keycloak-events.service.js.map
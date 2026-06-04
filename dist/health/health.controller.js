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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const common_2 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const redis_module_1 = require("../common/redis/redis.module");
let HealthController = class HealthController {
    constructor(mainDb, auditDb, redis) {
        this.mainDb = mainDb;
        this.auditDb = auditDb;
        this.redis = redis;
    }
    live() {
        return { status: 'ok', timestamp: new Date().toISOString() };
    }
    async ready() {
        const checks = await Promise.allSettled([
            this.mainDb.query('SELECT 1').then(() => 'connected'),
            this.auditDb.query('SELECT 1').then(() => 'connected'),
            this.redis.ping().then(() => 'connected'),
        ]);
        const [mainDbResult, auditDbResult, redisResult] = checks;
        const result = {
            status: checks.every((c) => c.status === 'fulfilled') ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            mainDb: mainDbResult.status === 'fulfilled' ? 'connected' : 'disconnected',
            auditDb: auditDbResult.status === 'fulfilled' ? 'connected' : 'disconnected',
            redis: redisResult.status === 'fulfilled' ? 'connected' : 'disconnected',
        };
        return result;
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Liveness probe — is the process alive?' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "live", null);
__decorate([
    (0, common_1.Get)('ready'),
    (0, swagger_1.ApiOperation)({ summary: 'Readiness probe — checks main DB, audit DB, and Redis' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('health'),
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('health'),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __param(1, (0, typeorm_1.InjectDataSource)('audit')),
    __param(2, (0, common_2.Inject)(redis_module_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [typeorm_2.DataSource,
        typeorm_2.DataSource, Function])
], HealthController);
//# sourceMappingURL=health.controller.js.map